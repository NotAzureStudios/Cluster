#pragma once

#include "CoreMinimal.h"

class FJsonObject;
class FJsonValue;

inline constexpr int32 CLUSTER_WORKSTATION_DISCOVERY_SCHEMA = 1;
inline constexpr int32 CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL = 1;

struct FClusterWorkstationRuntimeStatus
{
    bool bAvailable = false;
    int32 Protocol = 0;
    FString ServiceVersion;
    FString Error;
};

struct FClusterWorkstationDiscovery
{
    bool bValid = false;
    int32 Schema = 0;
    int32 Protocol = 0;
    int64 ProcessId = 0;
    FString Endpoint;
    FString Token;
    FString Version;
    FString Error;
};

struct FClusterWorkstationActionResponse
{
    bool bOk = false;
    TSharedPtr<FJsonValue> Result;
    FString ErrorCode;
    FString ErrorMessage;
};


struct FClusterWorkstationHistoryEntry
{
    FString Revision;
    FString ShortRevision;
    FString Author;
    FString AuthoredAt;
    FString Summary;
};

struct FClusterWorkstationOperationSnapshot
{
    bool bValid = false;
    FString Id;
    FString State;
    FString Stage;
    int32 Progress = 0;
    FString ProgressMessage;
    FString LastError;
};

struct FClusterResolvedRepository
{
    bool bValid = false;
    FString RepositoryId;
    FString WorkspaceId;
    FString DisplayName;
    FString ProjectRelativePrefix;
    FString Error;
};

/**
 * Thin authenticated loopback client for the Cluster Desktop Workstation
 * service. Unreal never executes Git or stores Git credentials itself.
 */
class CLUSTERSOURCECONTROL_API FClusterWorkstationClient
{
public:
    FClusterWorkstationClient();

    static FClusterWorkstationDiscovery ReadDiscovery();
    const FString& GetBaseUrl() const { return BaseUrl; }
    bool HasAuthenticatedEndpoint() const { return !BaseUrl.IsEmpty() && !Token.IsEmpty(); }
    void RefreshDiscovery();
    void ProbeRuntime(TFunction<void(FClusterWorkstationRuntimeStatus)> Completion) const;

    bool ResolveRepositoryBlocking(const FString& ProjectPath, FClusterResolvedRepository& OutRepository) const;
    bool RequestHistoryBlocking(const FString& RepositoryId, const FString& Path, int32 Limit, TArray<FClusterWorkstationHistoryEntry>& OutEntries, FString& OutError) const;
    bool MaterializeRevisionBlocking(const FString& RepositoryId, const FString& Path, const FString& Revision, FString& OutPath, FString& OutError) const;
    bool StartOperationBlocking(const FString& RepositoryId, const TArray<FString>& Paths, const TSharedPtr<FJsonObject>& Input, FClusterWorkstationOperationSnapshot& OutOperation, FString& OutError) const;
    bool GetOperationStatusBlocking(const FString& RepositoryId, const FString& OperationId, FClusterWorkstationOperationSnapshot& OutOperation, FString& OutError) const;
    bool CancelOperationBlocking(const FString& RepositoryId, const FString& OperationId, FClusterWorkstationOperationSnapshot& OutOperation, FString& OutError) const;
    bool RequestActionBlocking(
        const FString& Action,
        const FString& RepositoryId,
        const TArray<FString>& Paths,
        const TSharedPtr<FJsonObject>& Input,
        FClusterWorkstationActionResponse& OutResponse,
        float TimeoutSeconds = 20.0f) const;

private:
    FString BaseUrl;
    FString Token;
    FString DiscoveryError;
};
