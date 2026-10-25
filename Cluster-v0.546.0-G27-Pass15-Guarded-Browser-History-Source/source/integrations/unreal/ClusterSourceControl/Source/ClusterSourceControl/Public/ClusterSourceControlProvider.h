#pragma once

#include "CoreMinimal.h"
#include "ISourceControlProvider.h"
#include "ClusterSourceControlState.h"
#include "ClusterWorkstationClient.h"
#include "Runtime/Launch/Resources/Version.h"

struct FClusterAsyncSourceControlCommand : public TSharedFromThis<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>
{
    FClusterAsyncSourceControlCommand(
        const FSourceControlOperationRef& InOperation,
        FSourceControlOperationComplete InCompletion,
        TArray<FString> InFiles,
        FString InRepositoryId,
        FClusterWorkstationClient InClient,
        TArray<FString> InRepositoryPaths,
        TSharedPtr<FJsonObject> InInput,
        bool bInReleaseLocks)
        : Operation(InOperation)
        , Completion(MoveTemp(InCompletion))
        , Files(MoveTemp(InFiles))
        , RepositoryId(MoveTemp(InRepositoryId))
        , Client(MoveTemp(InClient))
        , RepositoryPaths(MoveTemp(InRepositoryPaths))
        , Input(MoveTemp(InInput))
        , bReleaseLocks(bInReleaseLocks)
    {
    }

    FSourceControlOperationRef Operation;
    FSourceControlOperationComplete Completion;
    TArray<FString> Files;
    FString RepositoryId;
    FClusterWorkstationClient Client;
    TArray<FString> RepositoryPaths;
    TSharedPtr<FJsonObject> Input;
    bool bReleaseLocks = false;

    mutable FCriticalSection Mutex;
    bool bCancelRequested = false;
    bool bCancelSent = false;
    bool bFinished = false;
    FString WorkstationOperationId;
    FString Error;
    ECommandResult::Type Result = ECommandResult::Failed;
};

class CLUSTERSOURCECONTROL_API FClusterSourceControlProvider final : public ISourceControlProvider
{
public:
    FClusterSourceControlProvider();
    virtual ~FClusterSourceControlProvider() override = default;

    virtual void Init(bool bForceConnection = true) override;
#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 8
    virtual FInitResult Init(EInitFlags Flags) override;
#endif
    virtual void Close() override;
    virtual FText GetStatusText() const override;
#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 3
    virtual TMap<EStatus, FString> GetStatus() const override;
#endif
    virtual bool IsEnabled() const override { return bEnabled; }
    virtual bool IsAvailable() const override { return bAvailable; }
    virtual const FName& GetName() const override;
    virtual bool QueryStateBranchConfig(const FString&, const FString&) override { return false; }
    virtual void RegisterStateBranches(const TArray<FString>&, const FString&) override {}
    virtual int32 GetStateBranchIndex(const FString&) const override { return INDEX_NONE; }
#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 7
    virtual bool GetStateBranchAtIndex(int32, FString&) const override { return false; }
#endif
    virtual ECommandResult::Type GetState(const TArray<FString>& InFiles, TArray<FSourceControlStateRef>& OutState, EStateCacheUsage::Type InStateCacheUsage) override;
#if ENGINE_MAJOR_VERSION == 5
    virtual ECommandResult::Type GetState(const TArray<FSourceControlChangelistRef>&, TArray<FSourceControlChangelistStateRef>& OutState, EStateCacheUsage::Type) override { OutState.Reset(); return ECommandResult::Failed; }
#endif
    virtual TArray<FSourceControlStateRef> GetCachedStateByPredicate(TFunctionRef<bool(const FSourceControlStateRef&)> Predicate) const override;
    virtual FDelegateHandle RegisterSourceControlStateChanged_Handle(const FSourceControlStateChanged::FDelegate& Delegate) override { return OnSourceControlStateChanged.Add(Delegate); }
    virtual void UnregisterSourceControlStateChanged_Handle(FDelegateHandle Handle) override { OnSourceControlStateChanged.Remove(Handle); }
#if ENGINE_MAJOR_VERSION == 5
    virtual ECommandResult::Type Execute(const FSourceControlOperationRef& InOperation, FSourceControlChangelistPtr InChangelist, const TArray<FString>& InFiles, EConcurrency::Type InConcurrency = EConcurrency::Synchronous, const FSourceControlOperationComplete& InOperationCompleteDelegate = FSourceControlOperationComplete()) override;
#endif
    virtual bool CanExecuteOperation(const FSourceControlOperationRef& InOperation) const override;
    virtual bool CanCancelOperation(const FSourceControlOperationRef& InOperation) const override;
    virtual void CancelOperation(const FSourceControlOperationRef& InOperation) override;
    virtual bool UsesLocalReadOnlyState() const override { return false; }
    virtual bool UsesChangelists() const override { return false; }
    virtual bool UsesUncontrolledChangelists() const override { return false; }
    virtual bool UsesCheckout() const override { return true; }
    virtual bool UsesFileRevisions() const override { return true; }
    virtual bool UsesSnapshots() const override { return false; }
    virtual bool AllowsDiffAgainstDepot() const override { return true; }
#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 1 && ENGINE_MINOR_VERSION < 8
    virtual TOptional<bool> IsAtLatestRevision() const override { return TOptional<bool>(); }
    virtual TOptional<int> GetNumLocalChanges() const override;
#endif
#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 8
    virtual bool UsesSoftRevertOnDelete() const override { return false; }
    virtual TOptional<bool> HasChangesToSync() const override { return TOptional<bool>(); }
    virtual TOptional<bool> HasChangesToCheckIn() const override;
#endif
    virtual void Tick() override;
    virtual TArray<TSharedRef<ISourceControlLabel>> GetLabels(const FString&) const override { return {}; }
#if ENGINE_MAJOR_VERSION == 5
    virtual TArray<FSourceControlChangelistRef> GetChangelists(EStateCacheUsage::Type) override { return {}; }
#endif
#if SOURCE_CONTROL_WITH_SLATE
    virtual TSharedRef<SWidget> MakeSettingsWidget() const override;
#endif

    using ISourceControlProvider::Execute;

private:
    bool ResolveRepository();
    FString ToRepositoryRelativePath(const FString& Filename) const;
    FClusterSourceControlStateRef StateForFile(const FString& Filename);
    bool RefreshStatesBlocking(const TArray<FString>& Files);
    bool HydrateHistoryBlocking(const TArray<FString>& Files, int32 Limit = 50);
    bool ExecuteWorkstationAction(const FString& Action, const TArray<FString>& Files, const TSharedPtr<FJsonObject>& Input, float TimeoutSeconds = 20.0f);
    void ReleaseOwnedLocks(const TArray<FString>& Files);
    ECommandResult::Type ExecuteSynchronously(const FSourceControlOperationRef& InOperation, const TArray<FString>& InFiles, const FSourceControlOperationComplete& InOperationCompleteDelegate);
    ECommandResult::Type QueueAsyncWorkstationOperation(const FSourceControlOperationRef& InOperation, const TArray<FString>& InFiles, const FSourceControlOperationComplete& InOperationCompleteDelegate);

    FClusterWorkstationClient Client;
    FString RepositoryId;
    FString RepositoryName;
    FString ProjectRelativePrefix;
    FString LastError;
    bool bEnabled = true;
    bool bAvailable = false;
    TMap<FString, FClusterSourceControlStateRef> StateCache;
    FSourceControlStateChanged OnSourceControlStateChanged;
    TArray<TSharedRef<FClusterAsyncSourceControlCommand, ESPMode::ThreadSafe>> PendingCommands;
};
