#include "ClusterSourceControlState.h"

#define LOCTEXT_NAMESPACE "ClusterSourceControlState"

FClusterSourceControlState::FClusterSourceControlState(FString InFilename)
    : Filename(MoveTemp(InFilename)), TimeStamp(FDateTime::UtcNow())
{
}

void FClusterSourceControlState::UpdateFromWorkstation(
    const FString& InState,
    bool bInTracked,
    bool bInIgnored,
    bool bInBinary,
    bool bInLockable,
    const FString& InLockOwnership,
    const FString& InLockOwner)
{
    State = InState.ToLower();
    bTracked = bInTracked;
    bIgnored = bInIgnored;
    bBinary = bInBinary;
    bLockable = bInLockable;
    LockOwnership = InLockOwnership.ToLower();
    LockOwner = InLockOwner;
    TimeStamp = FDateTime::UtcNow();
}

FText FClusterSourceControlState::GetDisplayName() const
{
    if (IsCheckedOutOther()) return LOCTEXT("LockedOther", "Locked by another user");
    if (IsCheckedOut()) return LOCTEXT("LockedOurs", "Locked by you");
    if (State == TEXT("clean")) return LOCTEXT("Clean", "Clean");
    if (State == TEXT("untracked")) return LOCTEXT("Untracked", "Untracked");
    if (State == TEXT("added")) return LOCTEXT("Added", "Added");
    if (State == TEXT("modified")) return LOCTEXT("Modified", "Modified");
    if (State == TEXT("deleted")) return LOCTEXT("Deleted", "Deleted");
    if (State == TEXT("renamed")) return LOCTEXT("Renamed", "Renamed");
    if (State == TEXT("conflicted")) return LOCTEXT("Conflicted", "Conflicted");
    if (IsIgnored()) return LOCTEXT("Ignored", "Ignored");
    return LOCTEXT("Unknown", "Unknown");
}

FText FClusterSourceControlState::GetDisplayTooltip() const
{
    if (IsCheckedOutOther())
    {
        return FText::Format(LOCTEXT("LockedOtherTooltip", "Git LFS lock owned by {0}."), FText::FromString(LockOwner));
    }
    if (IsCheckedOut()) return LOCTEXT("LockedOursTooltip", "Git LFS lock owned by you through Cluster Desktop.");
    if (bLockable) return FText::Format(LOCTEXT("LockableTooltip", "{0}. This binary asset uses Cluster Desktop Git LFS locking."), GetDisplayName());
    return GetDisplayName();
}

bool FClusterSourceControlState::CanCheckIn() const
{
    return !IsCheckedOutOther() && (State == TEXT("added") || State == TEXT("modified") || State == TEXT("deleted") || State == TEXT("renamed") || State == TEXT("conflicted"));
}

bool FClusterSourceControlState::CanCheckout() const
{
    return bLockable && !IsCheckedOut() && !IsCheckedOutOther() && !IsIgnored();
}

bool FClusterSourceControlState::IsCheckedOut() const
{
    return LockOwnership == TEXT("ours");
}

bool FClusterSourceControlState::IsCheckedOutOther(FString* Who) const
{
    const bool bOther = LockOwnership == TEXT("theirs");
    if (bOther && Who) *Who = LockOwner;
    return bOther;
}

bool FClusterSourceControlState::CanEdit() const
{
    if (IsCheckedOutOther()) return false;
    if (!bLockable) return true;
    return IsCheckedOut();
}

bool FClusterSourceControlState::IsModified() const
{
    return State == TEXT("added") || State == TEXT("modified") || State == TEXT("deleted") || State == TEXT("renamed") || State == TEXT("conflicted");
}


TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> FClusterSourceControlState::GetHistoryItem(int32 HistoryIndex) const
{
    return History.IsValidIndex(HistoryIndex) ? History[HistoryIndex] : nullptr;
}

TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> FClusterSourceControlState::FindHistoryRevision(int32 RevisionNumber) const
{
    for (const TSharedRef<FClusterSourceControlRevision, ESPMode::ThreadSafe>& Revision : History)
    {
        if (Revision->GetRevisionNumber() == RevisionNumber) return Revision;
    }
    return nullptr;
}

TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> FClusterSourceControlState::FindHistoryRevision(const FString& RevisionText) const
{
    for (const TSharedRef<FClusterSourceControlRevision, ESPMode::ThreadSafe>& Revision : History)
    {
        if (Revision->GetRevision().Equals(RevisionText, ESearchCase::IgnoreCase) || Revision->GetFullRevision().Equals(RevisionText, ESearchCase::IgnoreCase))
        {
            return Revision;
        }
    }
    return nullptr;
}

TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> FClusterSourceControlState::GetCurrentRevision() const
{
    return History.Num() > 0 ? History[0] : nullptr;
}

void FClusterSourceControlState::ReplaceHistory(TArray<TSharedRef<FClusterSourceControlRevision, ESPMode::ThreadSafe>> InHistory)
{
    History = MoveTemp(InHistory);
    TimeStamp = FDateTime::UtcNow();
}

#undef LOCTEXT_NAMESPACE
