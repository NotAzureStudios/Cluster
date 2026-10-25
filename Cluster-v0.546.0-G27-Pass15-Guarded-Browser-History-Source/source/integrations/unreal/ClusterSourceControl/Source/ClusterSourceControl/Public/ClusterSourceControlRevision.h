#pragma once

#include "CoreMinimal.h"
#include "ISourceControlRevision.h"
#include "ISourceControlState.h"
#include "ClusterWorkstationClient.h"

/** A Git commit-backed Unreal revision materialized through Cluster Desktop Workstation. */
class CLUSTERSOURCECONTROL_API FClusterSourceControlRevision final : public ISourceControlRevision
{
public:
    FClusterSourceControlRevision(
        FClusterWorkstationClient InClient,
        FString InRepositoryId,
        FString InRepositoryPath,
        FString InLocalFilename,
        FString InRevision,
        FString InShortRevision,
        FString InDescription,
        FString InAuthor,
        FDateTime InDate,
        int32 InRevisionNumber);

    virtual bool Get(FString& InOutFilename, EConcurrency::Type InConcurrency = EConcurrency::Synchronous) const override;
    virtual bool GetAnnotated(TArray<FAnnotationLine>& OutLines) const override { OutLines.Reset(); return false; }
    virtual bool GetAnnotated(FString& InOutFilename) const override { return false; }
    virtual const FString& GetFilename() const override { return LocalFilename; }
    virtual int32 GetRevisionNumber() const override { return RevisionNumber; }
    virtual const FString& GetRevision() const override { return ShortRevision; }
    virtual const FString& GetDescription() const override { return Description; }
    virtual const FString& GetUserName() const override { return Author; }
    virtual const FString& GetClientSpec() const override { return Empty; }
    virtual const FString& GetAction() const override { return Action; }
    virtual TSharedPtr<ISourceControlRevision, ESPMode::ThreadSafe> GetBranchSource() const override { return nullptr; }
    virtual const FDateTime& GetDate() const override { return Date; }
    virtual int32 GetCheckInIdentifier() const override { return RevisionNumber; }
    virtual int32 GetFileSize() const override { return FileSize; }

    const FString& GetFullRevision() const { return Revision; }

private:
    FClusterWorkstationClient Client;
    FString RepositoryId;
    FString RepositoryPath;
    FString LocalFilename;
    FString Revision;
    FString ShortRevision;
    FString Description;
    FString Author;
    FString Empty;
    FString Action = TEXT("edit");
    FDateTime Date;
    int32 RevisionNumber = ISourceControlState::INVALID_REVISION;
    mutable int32 FileSize = 0;
};
