#pragma once

#include "CoreMinimal.h"
#include "ISourceControlState.h"
#include "ClusterSourceControlRevision.h"

/** Lightweight state object backed by the Cluster Workstation SCM projection. */
class CLUSTERSOURCECONTROL_API FClusterSourceControlState final : public ISourceControlState
{
public:
    explicit FClusterSourceControlState(FString InFilename);

    void UpdateFromWorkstation(
        const FString& InState,
        bool bInTracked,
        bool bInIgnored,
        bool bInBinary,
        bool bInLockable,
        const FString& InLockOwnership,
        const FString& InLockOwner);

    virtual int32 GetHistorySize() const override { return History.Num(); }
    virtual TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> GetHistoryItem(int32 HistoryIndex) const override;
    virtual TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> FindHistoryRevision(int32 RevisionNumber) const override;
    virtual TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> FindHistoryRevision(const FString& Revision) const override;
    virtual TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> GetCurrentRevision() const override;
#if ENGINE_MAJOR_VERSION == 5 && ENGINE_MINOR_VERSION >= 3
    virtual FResolveInfo GetResolveInfo() const override { return FResolveInfo(); }
#endif
#if SOURCE_CONTROL_WITH_SLATE
    virtual FSlateIcon GetIcon() const override { return FSlateIcon(); }
#endif
    virtual FText GetDisplayName() const override;
    virtual FText GetDisplayTooltip() const override;
    virtual const FString& GetFilename() const override { return Filename; }
    virtual const FDateTime& GetTimeStamp() const override { return TimeStamp; }
    virtual bool CanCheckIn() const override;
    virtual bool CanCheckout() const override;
    virtual bool IsCheckedOut() const override;
    virtual bool IsCheckedOutOther(FString* Who = nullptr) const override;
    virtual bool IsCheckedOutInOtherBranch(const FString& = FString()) const override { return false; }
    virtual bool IsModifiedInOtherBranch(const FString& = FString()) const override { return false; }
    virtual bool IsCheckedOutOrModifiedInOtherBranch(const FString& = FString()) const override { return false; }
    virtual TArray<FString> GetCheckedOutBranches() const override { return {}; }
    virtual FString GetOtherUserBranchCheckedOuts() const override { return FString(); }
    virtual bool GetOtherBranchHeadModification(FString&, FString&, int32&) const override { return false; }
    virtual bool IsCurrent() const override { return !IsConflicted(); }
    virtual bool IsSourceControlled() const override { return bTracked; }
    virtual bool IsAdded() const override { return State == TEXT("added"); }
    virtual bool IsDeleted() const override { return State == TEXT("deleted"); }
    virtual bool IsIgnored() const override { return bIgnored || State == TEXT("ignored"); }
    virtual bool CanEdit() const override;
    virtual bool IsUnknown() const override { return State.IsEmpty() || State == TEXT("unknown"); }
    virtual bool IsModified() const override;
    virtual bool CanAdd() const override { return !bTracked && !IsIgnored() && !IsDeleted(); }
    virtual bool CanDelete() const override { return bTracked && !IsCheckedOutOther(); }
    virtual bool IsConflicted() const override { return State == TEXT("conflicted"); }
    virtual bool CanRevert() const override { return IsModified() || IsCheckedOut(); }

    bool IsLockable() const { return bLockable; }
    void ReplaceHistory(TArray<TSharedRef<FClusterSourceControlRevision, ESPMode::ThreadSafe>> InHistory);

private:
    FString Filename;
    FString State = TEXT("unknown");
    bool bTracked = false;
    bool bIgnored = false;
    bool bBinary = false;
    bool bLockable = false;
    FString LockOwnership;
    FString LockOwner;
    FDateTime TimeStamp;
    TArray<TSharedRef<FClusterSourceControlRevision, ESPMode::ThreadSafe>> History;
};

using FClusterSourceControlStateRef = TSharedRef<FClusterSourceControlState, ESPMode::ThreadSafe>;
