#include "ClusterSourceControlProvider.h"

#include "Async/Async.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/PlatformProcess.h"
#include "Misc/Paths.h"
#include "Misc/ScopeLock.h"
#include "SourceControlOperations.h"
#if SOURCE_CONTROL_WITH_SLATE
#include "Widgets/Text/STextBlock.h"
#endif

#define LOCTEXT_NAMESPACE "ClusterSourceControlProvider"

namespace
{
const FName ProviderName(TEXT("Cluster"));

bool OperationIs(const FSourceControlOperationRef& Operation, const TCHAR* Name)
{
    return Operation->GetName() == FName(Name);
}

bool IsTerminalOperationState(const FString& State)
{
    return State == TEXT("succeeded") || State == TEXT("failed") || State == TEXT("cancelled");
}

void FinishAsyncCommand(
    const TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>& Command,
    ECommandResult::Type Result,
    FString Error)
{
    FScopeLock Lock(&Command->Mutex);
    Command->Result = Result;
    Command->Error = MoveTemp(Error);
    Command->bFinished = true;
}

void RunAsyncWorkstationCommand(const TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>& Command)
{
    FClusterWorkstationOperationSnapshot Snapshot;
    FString Error;
    if (!Command->Client.StartOperationBlocking(Command->RepositoryId, Command->RepositoryPaths, Command->Input, Snapshot, Error))
    {
        FinishAsyncCommand(Command, ECommandResult::Failed, Error);
        return;
    }

    {
        FScopeLock Lock(&Command->Mutex);
        Command->WorkstationOperationId = Snapshot.Id;
    }

    constexpr int32 MaxPolls = 3600; // 15 minutes at 250 ms. Long operations should surface as explicit failures instead of hanging forever.
    for (int32 Poll = 0; Poll < MaxPolls; ++Poll)
    {
        bool bCancelRequested = false;
        bool bCancelSent = false;
        {
            FScopeLock Lock(&Command->Mutex);
            bCancelRequested = Command->bCancelRequested;
            bCancelSent = Command->bCancelSent;
        }

        if (bCancelRequested && !bCancelSent)
        {
            FClusterWorkstationOperationSnapshot CancelSnapshot;
            FString CancelError;
            const bool bCancelAccepted = Command->Client.CancelOperationBlocking(Command->RepositoryId, Snapshot.Id, CancelSnapshot, CancelError);
            {
                FScopeLock Lock(&Command->Mutex);
                Command->bCancelSent = bCancelAccepted;
            }
            if (!bCancelAccepted && !CancelError.IsEmpty())
            {
                FinishAsyncCommand(Command, ECommandResult::Failed, CancelError);
                return;
            }
        }

        if (IsTerminalOperationState(Snapshot.State))
        {
            if (Snapshot.State == TEXT("succeeded"))
            {
                FinishAsyncCommand(Command, ECommandResult::Succeeded, FString());
            }
            else if (Snapshot.State == TEXT("cancelled"))
            {
                FinishAsyncCommand(Command, ECommandResult::Cancelled, Snapshot.LastError);
            }
            else
            {
                FinishAsyncCommand(Command, ECommandResult::Failed, Snapshot.LastError.IsEmpty() ? TEXT("Cluster Workstation source-control operation failed.") : Snapshot.LastError);
            }
            return;
        }

        FPlatformProcess::Sleep(0.25f);
        if (!Command->Client.GetOperationStatusBlocking(Command->RepositoryId, Snapshot.Id, Snapshot, Error))
        {
            FinishAsyncCommand(Command, ECommandResult::Failed, Error);
            return;
        }
    }

    FClusterWorkstationOperationSnapshot CancelSnapshot;
    FString CancelError;
    Command->Client.CancelOperationBlocking(Command->RepositoryId, Snapshot.Id, CancelSnapshot, CancelError);
    FinishAsyncCommand(Command, ECommandResult::Failed, TEXT("Cluster Workstation source-control operation exceeded the editor safety timeout."));
}
}

FClusterSourceControlProvider::FClusterSourceControlProvider() = default;

const FName& FClusterSourceControlProvider::GetName() const
{
    return ProviderName;
}

void FClusterSourceControlProvider::Init(bool bForceConnection)
{
    bEnabled = true;
    Client.RefreshDiscovery();
    if (bForceConnection)
    {
        bAvailable = ResolveRepository();
    }
    else
    {
        bAvailable = !RepositoryId.IsEmpty();
    }
}

#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 8
ISourceControlProvider::FInitResult FClusterSourceControlProvider::Init(EInitFlags Flags)
{
    const bool bAttemptConnection = (Flags & EInitFlags::AttemptConnection) != 0;
    Init(bAttemptConnection);

    FInitResult Result;
    Result.bIsAvailable = bAvailable;
    Result.ConnectionSettings = GetStatus();
    return Result;
}
#endif

void FClusterSourceControlProvider::Close()
{
    for (const TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>& Command : PendingCommands)
    {
        FScopeLock Lock(&Command->Mutex);
        Command->bCancelRequested = true;
    }
    PendingCommands.Reset();
    StateCache.Reset();
    RepositoryId.Reset();
    RepositoryName.Reset();
    ProjectRelativePrefix.Reset();
    bAvailable = false;
}

bool FClusterSourceControlProvider::ResolveRepository()
{
    Client.RefreshDiscovery();
    FClusterResolvedRepository Resolution;
    if (!Client.ResolveRepositoryBlocking(FPaths::ProjectDir(), Resolution))
    {
        RepositoryId.Reset();
        RepositoryName.Reset();
        ProjectRelativePrefix.Reset();
        LastError = Resolution.Error;
        return false;
    }
    RepositoryId = Resolution.RepositoryId;
    RepositoryName = Resolution.DisplayName;
    ProjectRelativePrefix = Resolution.ProjectRelativePrefix;
    LastError.Reset();
    return true;
}

FText FClusterSourceControlProvider::GetStatusText() const
{
    if (!bAvailable)
    {
        return LastError.IsEmpty() ? LOCTEXT("Unavailable", "Cluster Desktop Workstation is unavailable.") : FText::FromString(LastError);
    }
    return FText::Format(LOCTEXT("Connected", "Cluster Desktop · {0}"), FText::FromString(RepositoryName));
}

#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 3
TMap<ISourceControlProvider::EStatus, FString> FClusterSourceControlProvider::GetStatus() const
{
    TMap<EStatus, FString> Status;
    Status.Add(EStatus::Enabled, bEnabled ? TEXT("Yes") : TEXT("No"));
    Status.Add(EStatus::Connected, bAvailable ? TEXT("Yes") : TEXT("No"));
    Status.Add(EStatus::Repository, RepositoryName);
    Status.Add(EStatus::PluginVersion, TEXT("0.3.0"));
    Status.Add(EStatus::ScmVersion, TEXT("Cluster Workstation SCM protocol 1"));
    return Status;
}
#endif

FString FClusterSourceControlProvider::ToRepositoryRelativePath(const FString& Filename) const
{
    FString Full = FPaths::ConvertRelativePathToFull(Filename);
    FString ProjectRoot = FPaths::ConvertRelativePathToFull(FPaths::ProjectDir());
    FString Relative = Full;
    if (!FPaths::MakePathRelativeTo(Relative, *ProjectRoot))
    {
        return FString();
    }
    Relative.ReplaceInline(TEXT("\\"), TEXT("/"));
    while (Relative.StartsWith(TEXT("./"))) Relative.RightChopInline(2);
    if (!ProjectRelativePrefix.IsEmpty())
    {
        Relative = FPaths::Combine(ProjectRelativePrefix, Relative);
        Relative.ReplaceInline(TEXT("\\"), TEXT("/"));
    }
    return Relative;
}

FClusterSourceControlStateRef FClusterSourceControlProvider::StateForFile(const FString& Filename)
{
    const FString Full = FPaths::ConvertRelativePathToFull(Filename);
    if (const FClusterSourceControlStateRef* Existing = StateCache.Find(Full))
    {
        return *Existing;
    }
    FClusterSourceControlStateRef State = MakeShared<FClusterSourceControlState, ESPMode::ThreadSafe>(Full);
    StateCache.Add(Full, State);
    return State;
}

bool FClusterSourceControlProvider::RefreshStatesBlocking(const TArray<FString>& Files)
{
    if (!bAvailable && !ResolveRepository()) return false;

    TArray<FString> RepoPaths;
    TMap<FString, FString> FullByRepoPath;
    for (const FString& File : Files)
    {
        const FString Full = FPaths::ConvertRelativePathToFull(File);
        const FString RepoPath = ToRepositoryRelativePath(Full);
        if (RepoPath.IsEmpty()) continue;
        RepoPaths.Add(RepoPath);
        FullByRepoPath.Add(RepoPath, Full);
        StateForFile(Full);
    }
    if (RepoPaths.IsEmpty()) return true;

    FClusterWorkstationActionResponse Response;
    if (!Client.RequestActionBlocking(TEXT("files.status"), RepositoryId, RepoPaths, MakeShared<FJsonObject>(), Response, 10.0f) || !Response.Result.IsValid())
    {
        LastError = Response.ErrorMessage;
        return false;
    }

    const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
    if (!Response.Result->TryGetArray(Values) || Values == nullptr)
    {
        LastError = TEXT("Cluster Workstation returned an invalid file-state payload.");
        return false;
    }

    for (const TSharedPtr<FJsonValue>& Value : *Values)
    {
        const TSharedPtr<FJsonObject>* Object = nullptr;
        if (!Value.IsValid() || !Value->TryGetObject(Object) || Object == nullptr || !Object->IsValid()) continue;
        FString Path;
        FString StateKind;
        (*Object)->TryGetStringField(TEXT("path"), Path);
        (*Object)->TryGetStringField(TEXT("state"), StateKind);
        const FString* Full = FullByRepoPath.Find(Path);
        if (!Full) continue;

        FString LockOwnership;
        FString LockOwner;
        const TSharedPtr<FJsonObject>* Lock = nullptr;
        if ((*Object)->TryGetObjectField(TEXT("lock"), Lock) && Lock && Lock->IsValid())
        {
            (*Lock)->TryGetStringField(TEXT("ownership"), LockOwnership);
            (*Lock)->TryGetStringField(TEXT("owner"), LockOwner);
        }
        StateForFile(*Full)->UpdateFromWorkstation(
            StateKind,
            (*Object)->GetBoolField(TEXT("tracked")),
            (*Object)->GetBoolField(TEXT("ignored")),
            (*Object)->GetBoolField(TEXT("binary")),
            (*Object)->GetBoolField(TEXT("lockable")),
            LockOwnership,
            LockOwner);
    }
    LastError.Reset();
    OnSourceControlStateChanged.Broadcast();
    return true;
}

bool FClusterSourceControlProvider::HydrateHistoryBlocking(const TArray<FString>& Files, int32 Limit)
{
    if (!bAvailable && !ResolveRepository()) return false;
    bool bSucceeded = true;
    for (const FString& File : Files)
    {
        const FString Full = FPaths::ConvertRelativePathToFull(File);
        const FString RepoPath = ToRepositoryRelativePath(Full);
        if (RepoPath.IsEmpty()) continue;

        TArray<FClusterWorkstationHistoryEntry> Entries;
        FString Error;
        if (!Client.RequestHistoryBlocking(RepositoryId, RepoPath, Limit, Entries, Error))
        {
            LastError = Error;
            bSucceeded = false;
            continue;
        }

        TArray<TSharedRef<FClusterSourceControlRevision, ESPMode::ThreadSafe>> History;
        History.Reserve(Entries.Num());
        for (int32 Index = 0; Index < Entries.Num(); ++Index)
        {
            const FClusterWorkstationHistoryEntry& Entry = Entries[Index];
            FDateTime ParsedDate(0);
            if (!Entry.AuthoredAt.IsEmpty())
            {
                FDateTime::ParseIso8601(*Entry.AuthoredAt, ParsedDate);
            }
            const int32 RevisionNumber = Entries.Num() - Index;
            History.Add(MakeShared<FClusterSourceControlRevision, ESPMode::ThreadSafe>(
                Client,
                RepositoryId,
                RepoPath,
                Full,
                Entry.Revision,
                Entry.ShortRevision.IsEmpty() ? Entry.Revision.Left(12) : Entry.ShortRevision,
                Entry.Summary,
                Entry.Author,
                ParsedDate,
                RevisionNumber));
        }
        StateForFile(Full)->ReplaceHistory(MoveTemp(History));
    }
    if (bSucceeded) LastError.Reset();
    return bSucceeded;
}

ECommandResult::Type FClusterSourceControlProvider::GetState(const TArray<FString>& InFiles, TArray<FSourceControlStateRef>& OutState, EStateCacheUsage::Type InStateCacheUsage)
{
    if (InStateCacheUsage == EStateCacheUsage::ForceUpdate && !RefreshStatesBlocking(InFiles))
    {
        OutState.Reset();
        return ECommandResult::Failed;
    }
    OutState.Reset(InFiles.Num());
    for (const FString& File : InFiles)
    {
        OutState.Add(StateForFile(File));
    }
    return ECommandResult::Succeeded;
}

TArray<FSourceControlStateRef> FClusterSourceControlProvider::GetCachedStateByPredicate(TFunctionRef<bool(const FSourceControlStateRef&)> Predicate) const
{
    TArray<FSourceControlStateRef> Results;
    for (const auto& Pair : StateCache)
    {
        if (Predicate(Pair.Value)) Results.Add(Pair.Value);
    }
    return Results;
}

bool FClusterSourceControlProvider::ExecuteWorkstationAction(const FString& Action, const TArray<FString>& Files, const TSharedPtr<FJsonObject>& Input, float TimeoutSeconds)
{
    if (!bAvailable && !ResolveRepository()) return false;
    TArray<FString> RepoPaths;
    for (const FString& File : Files)
    {
        const FString Relative = ToRepositoryRelativePath(File);
        if (!Relative.IsEmpty()) RepoPaths.Add(Relative);
    }
    FClusterWorkstationActionResponse Response;
    const bool bSucceeded = Client.RequestActionBlocking(Action, RepositoryId, RepoPaths, Input, Response, TimeoutSeconds);
    LastError = bSucceeded ? FString() : Response.ErrorMessage;
    return bSucceeded;
}

void FClusterSourceControlProvider::ReleaseOwnedLocks(const TArray<FString>& Files)
{
    RefreshStatesBlocking(Files);
    for (const FString& File : Files)
    {
        const FClusterSourceControlStateRef State = StateForFile(File);
        if (!State->IsCheckedOut()) continue;
        const FString Relative = ToRepositoryRelativePath(File);
        if (Relative.IsEmpty()) continue;
        FClusterWorkstationActionResponse Response;
        Client.RequestActionBlocking(TEXT("locks.release"), RepositoryId, {Relative}, MakeShared<FJsonObject>(), Response, 15.0f);
    }
}

bool FClusterSourceControlProvider::CanExecuteOperation(const FSourceControlOperationRef& InOperation) const
{
    const FName Name = InOperation->GetName();
    return Name == FName(TEXT("Connect")) || Name == FName(TEXT("UpdateStatus")) || Name == FName(TEXT("CheckOut")) ||
           Name == FName(TEXT("MarkForAdd")) || Name == FName(TEXT("Delete")) || Name == FName(TEXT("Revert")) ||
           Name == FName(TEXT("CheckIn")) || Name == FName(TEXT("Sync"));
}

ECommandResult::Type FClusterSourceControlProvider::ExecuteSynchronously(
    const FSourceControlOperationRef& InOperation,
    const TArray<FString>& InFiles,
    const FSourceControlOperationComplete& InOperationCompleteDelegate)
{
    bool bSuccess = false;
    if (OperationIs(InOperation, TEXT("Connect")))
    {
        bSuccess = ResolveRepository();
    }
    else if (OperationIs(InOperation, TEXT("UpdateStatus")))
    {
        bSuccess = RefreshStatesBlocking(InFiles);
        const TSharedRef<FUpdateStatus, ESPMode::ThreadSafe> Update = StaticCastSharedRef<FUpdateStatus>(InOperation);
        if (bSuccess && Update->ShouldUpdateHistory())
        {
            bSuccess = HydrateHistoryBlocking(InFiles);
        }
    }
    else if (OperationIs(InOperation, TEXT("MarkForAdd")))
    {
        bSuccess = ExecuteWorkstationAction(TEXT("files.add"), InFiles, MakeShared<FJsonObject>());
    }
    else if (OperationIs(InOperation, TEXT("Delete")))
    {
        bSuccess = ExecuteWorkstationAction(TEXT("files.delete"), InFiles, MakeShared<FJsonObject>());
    }
    else if (OperationIs(InOperation, TEXT("Revert")))
    {
        bSuccess = ExecuteWorkstationAction(TEXT("files.revert"), InFiles, MakeShared<FJsonObject>());
        if (bSuccess) ReleaseOwnedLocks(InFiles);
    }
    else if (OperationIs(InOperation, TEXT("CheckOut")))
    {
        bSuccess = RefreshStatesBlocking(InFiles);
        if (bSuccess)
        {
            for (const FString& File : InFiles)
            {
                const FClusterSourceControlStateRef State = StateForFile(File);
                if (!State->IsLockable() || State->IsCheckedOut()) continue;
                TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
                Input->SetBoolField(TEXT("lock"), true);
                if (!ExecuteWorkstationAction(TEXT("files.checkout"), {File}, Input))
                {
                    bSuccess = false;
                    break;
                }
            }
        }
    }
    else if (OperationIs(InOperation, TEXT("CheckIn")))
    {
        const TSharedRef<FCheckIn, ESPMode::ThreadSafe> CheckIn = StaticCastSharedRef<FCheckIn>(InOperation);
        TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
        Input->SetStringField(TEXT("message"), CheckIn->GetDescription().ToString());
        Input->SetBoolField(TEXT("push"), false);
        bSuccess = ExecuteWorkstationAction(TEXT("changes.commit"), InFiles, Input, 60.0f);
        if (bSuccess && !CheckIn->GetKeepCheckedOut()) ReleaseOwnedLocks(InFiles);
    }
    else if (OperationIs(InOperation, TEXT("Sync")))
    {
        TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
        Input->SetStringField(TEXT("mode"), TEXT("pull"));
        bSuccess = ExecuteWorkstationAction(TEXT("repository.sync"), {}, Input, 90.0f);
    }

    if (bSuccess && InFiles.Num() > 0) RefreshStatesBlocking(InFiles);
    const ECommandResult::Type Result = bSuccess ? ECommandResult::Succeeded : ECommandResult::Failed;
    if (InOperationCompleteDelegate.IsBound()) InOperationCompleteDelegate.Execute(InOperation, Result);
    return Result;
}

ECommandResult::Type FClusterSourceControlProvider::QueueAsyncWorkstationOperation(
    const FSourceControlOperationRef& InOperation,
    const TArray<FString>& InFiles,
    const FSourceControlOperationComplete& InOperationCompleteDelegate)
{
    if (!bAvailable && !ResolveRepository())
    {
        if (InOperationCompleteDelegate.IsBound()) InOperationCompleteDelegate.Execute(InOperation, ECommandResult::Failed);
        return ECommandResult::Failed;
    }

    TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
    bool bReleaseLocks = false;
    if (OperationIs(InOperation, TEXT("CheckIn")))
    {
        const TSharedRef<FCheckIn, ESPMode::ThreadSafe> CheckIn = StaticCastSharedRef<FCheckIn>(InOperation);
        Input->SetStringField(TEXT("action"), TEXT("changes.commit"));
        Input->SetStringField(TEXT("message"), CheckIn->GetDescription().ToString());
        Input->SetBoolField(TEXT("push"), false);
        bReleaseLocks = !CheckIn->GetKeepCheckedOut();
    }
    else if (OperationIs(InOperation, TEXT("Sync")))
    {
        Input->SetStringField(TEXT("action"), TEXT("repository.sync"));
        Input->SetStringField(TEXT("mode"), TEXT("pull"));
    }
    else
    {
        return ExecuteSynchronously(InOperation, InFiles, InOperationCompleteDelegate);
    }

    TArray<FString> RepositoryPaths;
    for (const FString& File : InFiles)
    {
        const FString Relative = ToRepositoryRelativePath(File);
        if (!Relative.IsEmpty()) RepositoryPaths.Add(Relative);
    }

    TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe> Command = MakeShared<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>(
        InOperation,
        InOperationCompleteDelegate,
        InFiles,
        RepositoryId,
        Client,
        MoveTemp(RepositoryPaths),
        Input,
        bReleaseLocks);
    PendingCommands.Add(Command);
    Async(EAsyncExecution::ThreadPool, [Command]() { RunAsyncWorkstationCommand(Command); });
    return ECommandResult::Succeeded;
}

ECommandResult::Type FClusterSourceControlProvider::Execute(
    const FSourceControlOperationRef& InOperation,
    FSourceControlChangelistPtr,
    const TArray<FString>& InFiles,
    EConcurrency::Type InConcurrency,
    const FSourceControlOperationComplete& InOperationCompleteDelegate)
{
    if (!CanExecuteOperation(InOperation))
    {
        if (InOperationCompleteDelegate.IsBound()) InOperationCompleteDelegate.Execute(InOperation, ECommandResult::Failed);
        return ECommandResult::Failed;
    }
    if (InConcurrency == EConcurrency::Asynchronous && (OperationIs(InOperation, TEXT("CheckIn")) || OperationIs(InOperation, TEXT("Sync"))))
    {
        return QueueAsyncWorkstationOperation(InOperation, InFiles, InOperationCompleteDelegate);
    }
    return ExecuteSynchronously(InOperation, InFiles, InOperationCompleteDelegate);
}

bool FClusterSourceControlProvider::CanCancelOperation(const FSourceControlOperationRef& InOperation) const
{
    for (const TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>& Command : PendingCommands)
    {
        if (&Command->Operation.Get() != &InOperation.Get()) continue;
        FScopeLock Lock(&Command->Mutex);
        return !Command->bFinished;
    }
    return false;
}

void FClusterSourceControlProvider::CancelOperation(const FSourceControlOperationRef& InOperation)
{
    for (const TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>& Command : PendingCommands)
    {
        if (&Command->Operation.Get() != &InOperation.Get()) continue;
        FScopeLock Lock(&Command->Mutex);
        if (!Command->bFinished) Command->bCancelRequested = true;
        return;
    }
}

void FClusterSourceControlProvider::Tick()
{
    for (int32 Index = PendingCommands.Num() - 1; Index >= 0; --Index)
    {
        const TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe> Command = PendingCommands[Index];
        bool bFinished = false;
        ECommandResult::Type Result = ECommandResult::Failed;
        FString Error;
        {
            FScopeLock Lock(&Command->Mutex);
            bFinished = Command->bFinished;
            Result = Command->Result;
            Error = Command->Error;
        }
        if (!bFinished) continue;

        if (Result == ECommandResult::Succeeded)
        {
            if (Command->Files.Num() > 0) RefreshStatesBlocking(Command->Files);
            if (Command->bReleaseLocks) ReleaseOwnedLocks(Command->Files);
            LastError.Reset();
        }
        else if (!Error.IsEmpty())
        {
            LastError = Error;
        }

        if (Command->Completion.IsBound()) Command->Completion.Execute(Command->Operation, Result);
        PendingCommands.RemoveAt(Index);
    }
}

#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 1 && ENGINE_MINOR_VERSION < 8
TOptional<int> FClusterSourceControlProvider::GetNumLocalChanges() const
{
    int32 Count = 0;
    for (const auto& Pair : StateCache) if (Pair.Value->IsModified()) ++Count;
    return Count;
}
#endif

#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 8
TOptional<bool> FClusterSourceControlProvider::HasChangesToCheckIn() const
{
    for (const auto& Pair : StateCache) if (Pair.Value->CanCheckIn()) return true;
    return false;
}
#endif

#if SOURCE_CONTROL_WITH_SLATE
TSharedRef<SWidget> FClusterSourceControlProvider::MakeSettingsWidget() const
{
    return SNew(STextBlock).Text(GetStatusText());
}
#endif

#undef LOCTEXT_NAMESPACE
