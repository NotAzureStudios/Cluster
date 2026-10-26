#include "ClusterSourceControlRevision.h"

#include "HAL/FileManager.h"
#include "Misc/Paths.h"

bool FClusterSourceControlRevision::Get(FString& InOutFilename, EConcurrency::Type) const
{
    FString MaterializedPath;
    FString Error;
    if (!Client.MaterializeRevisionBlocking(RepositoryId, RepositoryPath, Revision, MaterializedPath, Error))
    {
        return false;
    }

    const int64 Size = IFileManager::Get().FileSize(*MaterializedPath);
    FileSize = Size > MAX_int32 ? MAX_int32 : static_cast<int32>(FMath::Max<int64>(0, Size));

    if (InOutFilename.IsEmpty())
    {
        InOutFilename = MaterializedPath;
        return true;
    }

    const FString RequestedPath = FPaths::ConvertRelativePathToFull(InOutFilename);
    const FString SourcePath = FPaths::ConvertRelativePathToFull(MaterializedPath);
    if (RequestedPath.Equals(SourcePath, ESearchCase::IgnoreCase))
    {
        InOutFilename = SourcePath;
        return true;
    }

    IFileManager::Get().MakeDirectory(*FPaths::GetPath(RequestedPath), true);
    if (IFileManager::Get().Copy(*RequestedPath, *SourcePath, true, true) != COPY_OK)
    {
        return false;
    }
    InOutFilename = RequestedPath;
    return true;
}

FClusterSourceControlRevision::FClusterSourceControlRevision(
    FClusterWorkstationClient InClient,
    FString InRepositoryId,
    FString InRepositoryPath,
    FString InLocalFilename,
    FString InRevision,
    FString InShortRevision,
    FString InDescription,
    FString InAuthor,
    FDateTime InDate,
    int32 InRevisionNumber)
    : Client(MoveTemp(InClient))
    , RepositoryId(MoveTemp(InRepositoryId))
    , RepositoryPath(MoveTemp(InRepositoryPath))
    , LocalFilename(MoveTemp(InLocalFilename))
    , Revision(MoveTemp(InRevision))
    , ShortRevision(MoveTemp(InShortRevision))
    , Description(MoveTemp(InDescription))
    , Author(MoveTemp(InAuthor))
    , Date(InDate)
    , RevisionNumber(InRevisionNumber)
{
}
