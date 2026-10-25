#include "ClusterWorkstationClient.h"

#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "HAL/PlatformProcess.h"
#include "HttpModule.h"
#include "Interfaces/IHttpRequest.h"
#include "Interfaces/IHttpResponse.h"
#include "Misc/FileHelper.h"
#include "Misc/Guid.h"
#include "Misc/Paths.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

namespace
{
FString DiscoveryFilePath()
{
    return FPaths::Combine(FPlatformProcess::UserDir(), TEXT(".cluster"), TEXT("workstation"), TEXT("source-control-endpoint.json"));
}

bool IsLoopbackEndpoint(const FString& Endpoint)
{
    FString Normalized = Endpoint.ToLower();
    return Normalized.StartsWith(TEXT("http://127.0.0.1:")) ||
           Normalized.StartsWith(TEXT("http://localhost:")) ||
           Normalized.StartsWith(TEXT("http://[::1]:"));
}

bool ParseJsonObject(const FString& Text, TSharedPtr<FJsonObject>& OutJson)
{
    const TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(Text);
    return FJsonSerializer::Deserialize(Reader, OutJson) && OutJson.IsValid();
}
}

FClusterWorkstationClient::FClusterWorkstationClient()
{
    RefreshDiscovery();
}

FClusterWorkstationDiscovery FClusterWorkstationClient::ReadDiscovery()
{
    FClusterWorkstationDiscovery Discovery;
    FString Contents;
    if (!FFileHelper::LoadFileToString(Contents, *DiscoveryFilePath()))
    {
        Discovery.Error = TEXT("Cluster Desktop Workstation discovery file is unavailable.");
        return Discovery;
    }

    TSharedPtr<FJsonObject> Json;
    if (!ParseJsonObject(Contents, Json))
    {
        Discovery.Error = TEXT("Cluster Desktop Workstation discovery file is invalid JSON.");
        return Discovery;
    }

    double Schema = 0.0;
    double Protocol = 0.0;
    double ProcessId = 0.0;
    Json->TryGetNumberField(TEXT("schema"), Schema);
    Json->TryGetNumberField(TEXT("protocol"), Protocol);
    Json->TryGetNumberField(TEXT("pid"), ProcessId);
    Discovery.Schema = static_cast<int32>(Schema);
    Discovery.Protocol = static_cast<int32>(Protocol);
    Discovery.ProcessId = static_cast<int64>(ProcessId);
    Json->TryGetStringField(TEXT("endpoint"), Discovery.Endpoint);
    Json->TryGetStringField(TEXT("token"), Discovery.Token);
    Json->TryGetStringField(TEXT("version"), Discovery.Version);
    Discovery.Endpoint.RemoveFromEnd(TEXT("/"));

    if (Discovery.Schema != CLUSTER_WORKSTATION_DISCOVERY_SCHEMA || Discovery.Protocol != CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL)
    {
        Discovery.Error = TEXT("Cluster Desktop Workstation protocol is incompatible with this Unreal plugin.");
        return Discovery;
    }
    if (!IsLoopbackEndpoint(Discovery.Endpoint))
    {
        Discovery.Error = TEXT("Cluster Workstation discovery rejected a non-loopback endpoint.");
        return Discovery;
    }
    if (Discovery.Token.Len() < 32)
    {
        Discovery.Error = TEXT("Cluster Workstation discovery token is missing or invalid.");
        return Discovery;
    }

    Discovery.bValid = true;
    return Discovery;
}

void FClusterWorkstationClient::RefreshDiscovery()
{
    const FClusterWorkstationDiscovery Discovery = ReadDiscovery();
    if (!Discovery.bValid)
    {
        BaseUrl.Reset();
        Token.Reset();
        DiscoveryError = Discovery.Error;
        return;
    }
    BaseUrl = Discovery.Endpoint;
    Token = Discovery.Token;
    DiscoveryError.Reset();
}

void FClusterWorkstationClient::ProbeRuntime(TFunction<void(FClusterWorkstationRuntimeStatus)> Completion) const
{
    if (!HasAuthenticatedEndpoint())
    {
        FClusterWorkstationRuntimeStatus Status;
        Status.Error = DiscoveryError.IsEmpty() ? TEXT("Cluster Desktop Workstation service is unavailable.") : DiscoveryError;
        Completion(MoveTemp(Status));
        return;
    }

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(BaseUrl + TEXT("/v1/source-control/runtime"));
    Request->SetVerb(TEXT("GET"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + Token);
    Request->SetTimeout(2.0f);

    Request->OnProcessRequestComplete().BindLambda(
        [Completion = MoveTemp(Completion)](FHttpRequestPtr, FHttpResponsePtr Response, bool bConnectedSuccessfully) mutable
        {
            FClusterWorkstationRuntimeStatus Status;
            if (!bConnectedSuccessfully || !Response.IsValid())
            {
                Status.Error = TEXT("Cluster Desktop Workstation service is unavailable.");
                Completion(MoveTemp(Status));
                return;
            }

            if (Response->GetResponseCode() < 200 || Response->GetResponseCode() >= 300)
            {
                Status.Error = FString::Printf(TEXT("Cluster Workstation returned HTTP %d."), Response->GetResponseCode());
                Completion(MoveTemp(Status));
                return;
            }

            TSharedPtr<FJsonObject> Json;
            if (!ParseJsonObject(Response->GetContentAsString(), Json))
            {
                Status.Error = TEXT("Cluster Workstation returned invalid JSON.");
                Completion(MoveTemp(Status));
                return;
            }

            Status.bAvailable = Json->GetBoolField(TEXT("available"));
            Status.Protocol = Json->GetIntegerField(TEXT("protocol"));
            Json->TryGetStringField(TEXT("serviceVersion"), Status.ServiceVersion);
            if (Status.Protocol != CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL)
            {
                Status.bAvailable = false;
                Status.Error = TEXT("Cluster Workstation protocol is incompatible with this Unreal plugin.");
            }
            Completion(MoveTemp(Status));
        });

    if (!Request->ProcessRequest())
    {
        FClusterWorkstationRuntimeStatus Status;
        Status.Error = TEXT("Cluster Workstation request could not be started.");
        Completion(MoveTemp(Status));
    }
}

bool FClusterWorkstationClient::RequestActionBlocking(
    const FString& Action,
    const FString& RepositoryId,
    const TArray<FString>& Paths,
    const TSharedPtr<FJsonObject>& Input,
    FClusterWorkstationActionResponse& OutResponse,
    float TimeoutSeconds) const
{
    OutResponse = FClusterWorkstationActionResponse{};
    if (!HasAuthenticatedEndpoint())
    {
        OutResponse.ErrorCode = TEXT("WORKSTATION_UNAVAILABLE");
        OutResponse.ErrorMessage = DiscoveryError.IsEmpty() ? TEXT("Cluster Desktop Workstation service is unavailable.") : DiscoveryError;
        return false;
    }

    TSharedPtr<FJsonObject> Envelope = MakeShared<FJsonObject>();
    Envelope->SetNumberField(TEXT("schema"), 1);
    Envelope->SetNumberField(TEXT("protocol"), CLUSTER_WORKSTATION_SOURCE_CONTROL_PROTOCOL);
    Envelope->SetStringField(TEXT("requestId"), FGuid::NewGuid().ToString(EGuidFormats::DigitsWithHyphensLower));
    Envelope->SetStringField(TEXT("action"), Action);
    if (!RepositoryId.IsEmpty())
    {
        Envelope->SetStringField(TEXT("repositoryId"), RepositoryId);
    }
    TArray<TSharedPtr<FJsonValue>> JsonPaths;
    JsonPaths.Reserve(Paths.Num());
    for (const FString& Path : Paths)
    {
        JsonPaths.Add(MakeShared<FJsonValueString>(Path));
    }
    Envelope->SetArrayField(TEXT("paths"), JsonPaths);
    Envelope->SetObjectField(TEXT("input"), Input.IsValid() ? Input : MakeShared<FJsonObject>());

    FString Body;
    const TSharedRef<TJsonWriter<>> Writer = TJsonWriterFactory<>::Create(&Body);
    FJsonSerializer::Serialize(Envelope.ToSharedRef(), Writer);

    TSharedRef<IHttpRequest, ESPMode::ThreadSafe> Request = FHttpModule::Get().CreateRequest();
    Request->SetURL(BaseUrl + TEXT("/v1/source-control/actions"));
    Request->SetVerb(TEXT("POST"));
    Request->SetHeader(TEXT("Accept"), TEXT("application/json"));
    Request->SetHeader(TEXT("Content-Type"), TEXT("application/json"));
    Request->SetHeader(TEXT("Authorization"), TEXT("Bearer ") + Token);
    Request->SetContentAsString(Body);
    Request->SetTimeout(TimeoutSeconds);
    Request->ProcessRequestUntilComplete();

    const FHttpResponsePtr Response = Request->GetResponse();
    if (!Response.IsValid())
    {
        OutResponse.ErrorCode = TEXT("WORKSTATION_UNAVAILABLE");
        OutResponse.ErrorMessage = TEXT("Cluster Workstation returned no response.");
        return false;
    }
    if (Response->GetResponseCode() < 200 || Response->GetResponseCode() >= 300)
    {
        OutResponse.ErrorCode = TEXT("WORKSTATION_HTTP_ERROR");
        OutResponse.ErrorMessage = FString::Printf(TEXT("Cluster Workstation returned HTTP %d."), Response->GetResponseCode());
        return false;
    }

    TSharedPtr<FJsonObject> Json;
    if (!ParseJsonObject(Response->GetContentAsString(), Json))
    {
        OutResponse.ErrorCode = TEXT("WORKSTATION_INVALID_JSON");
        OutResponse.ErrorMessage = TEXT("Cluster Workstation returned invalid JSON.");
        return false;
    }

    OutResponse.bOk = Json->GetBoolField(TEXT("ok"));
    if (OutResponse.bOk)
    {
        OutResponse.Result = Json->TryGetField(TEXT("result"));
        return true;
    }

    const TSharedPtr<FJsonObject>* ErrorObject = nullptr;
    if (Json->TryGetObjectField(TEXT("error"), ErrorObject) && ErrorObject && ErrorObject->IsValid())
    {
        (*ErrorObject)->TryGetStringField(TEXT("code"), OutResponse.ErrorCode);
        (*ErrorObject)->TryGetStringField(TEXT("message"), OutResponse.ErrorMessage);
    }
    if (OutResponse.ErrorMessage.IsEmpty())
    {
        OutResponse.ErrorMessage = TEXT("Cluster Workstation rejected the source-control operation.");
    }
    return false;
}

bool FClusterWorkstationClient::ResolveRepositoryBlocking(const FString& ProjectPath, FClusterResolvedRepository& OutRepository) const
{
    OutRepository = FClusterResolvedRepository{};
    TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
    Input->SetStringField(TEXT("projectPath"), FPaths::ConvertRelativePathToFull(ProjectPath));
    FClusterWorkstationActionResponse Response;
    if (!RequestActionBlocking(TEXT("repository.resolve"), FString(), {}, Input, Response, 5.0f) || !Response.Result.IsValid())
    {
        OutRepository.Error = Response.ErrorMessage;
        return false;
    }
    const TSharedPtr<FJsonObject>* ResultObject = nullptr;
    if (!Response.Result->TryGetObject(ResultObject) || !ResultObject || !ResultObject->IsValid())
    {
        OutRepository.Error = TEXT("Cluster Workstation repository resolution returned an invalid payload.");
        return false;
    }
    (*ResultObject)->TryGetStringField(TEXT("repositoryId"), OutRepository.RepositoryId);
    (*ResultObject)->TryGetStringField(TEXT("workspaceId"), OutRepository.WorkspaceId);
    (*ResultObject)->TryGetStringField(TEXT("displayName"), OutRepository.DisplayName);
    (*ResultObject)->TryGetStringField(TEXT("projectRelativePrefix"), OutRepository.ProjectRelativePrefix);
    OutRepository.bValid = !OutRepository.RepositoryId.IsEmpty();
    if (!OutRepository.bValid)
    {
        OutRepository.Error = TEXT("Cluster Workstation did not return a repository identifier.");
    }
    return OutRepository.bValid;
}

namespace
{
bool ParseWorkstationOperation(const TSharedPtr<FJsonValue>& Result, FClusterWorkstationOperationSnapshot& OutOperation, FString& OutError)
{
    OutOperation = FClusterWorkstationOperationSnapshot{};
    if (!Result.IsValid())
    {
        OutError = TEXT("Cluster Workstation operation response was empty.");
        return false;
    }
    const TSharedPtr<FJsonObject>* Wrapper = nullptr;
    if (!Result->TryGetObject(Wrapper) || !Wrapper || !Wrapper->IsValid())
    {
        OutError = TEXT("Cluster Workstation operation response was invalid.");
        return false;
    }
    const TSharedPtr<FJsonObject>* Operation = nullptr;
    if (!(*Wrapper)->TryGetObjectField(TEXT("operation"), Operation) || !Operation || !Operation->IsValid())
    {
        OutError = TEXT("Cluster Workstation operation payload was missing.");
        return false;
    }
    (*Operation)->TryGetStringField(TEXT("id"), OutOperation.Id);
    (*Operation)->TryGetStringField(TEXT("state"), OutOperation.State);
    (*Operation)->TryGetStringField(TEXT("stage"), OutOperation.Stage);
    (*Operation)->TryGetStringField(TEXT("progressMessage"), OutOperation.ProgressMessage);
    (*Operation)->TryGetStringField(TEXT("lastError"), OutOperation.LastError);
    if ((*Operation)->HasTypedField<EJson::Number>(TEXT("progress")))
    {
        OutOperation.Progress = (*Operation)->GetIntegerField(TEXT("progress"));
    }
    OutOperation.bValid = !OutOperation.Id.IsEmpty();
    if (!OutOperation.bValid)
    {
        OutError = TEXT("Cluster Workstation operation identifier was missing.");
    }
    return OutOperation.bValid;
}
}

bool FClusterWorkstationClient::RequestHistoryBlocking(
    const FString& RepositoryId,
    const FString& Path,
    int32 Limit,
    TArray<FClusterWorkstationHistoryEntry>& OutEntries,
    FString& OutError) const
{
    OutEntries.Reset();
    OutError.Reset();
    TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
    Input->SetNumberField(TEXT("limit"), FMath::Clamp(Limit, 1, 100));
    FClusterWorkstationActionResponse Response;
    if (!RequestActionBlocking(TEXT("repository.history"), RepositoryId, {Path}, Input, Response, 10.0f) || !Response.Result.IsValid())
    {
        OutError = Response.ErrorMessage;
        return false;
    }
    const TArray<TSharedPtr<FJsonValue>>* Values = nullptr;
    if (!Response.Result->TryGetArray(Values) || !Values)
    {
        OutError = TEXT("Cluster Workstation returned an invalid history payload.");
        return false;
    }
    for (const TSharedPtr<FJsonValue>& Value : *Values)
    {
        const TSharedPtr<FJsonObject>* Object = nullptr;
        if (!Value.IsValid() || !Value->TryGetObject(Object) || !Object || !Object->IsValid()) continue;
        FClusterWorkstationHistoryEntry Entry;
        (*Object)->TryGetStringField(TEXT("revision"), Entry.Revision);
        (*Object)->TryGetStringField(TEXT("shortRevision"), Entry.ShortRevision);
        (*Object)->TryGetStringField(TEXT("author"), Entry.Author);
        (*Object)->TryGetStringField(TEXT("authoredAt"), Entry.AuthoredAt);
        (*Object)->TryGetStringField(TEXT("summary"), Entry.Summary);
        if (!Entry.Revision.IsEmpty()) OutEntries.Add(MoveTemp(Entry));
    }
    return true;
}

bool FClusterWorkstationClient::MaterializeRevisionBlocking(
    const FString& RepositoryId,
    const FString& Path,
    const FString& Revision,
    FString& OutPath,
    FString& OutError) const
{
    OutPath.Reset();
    OutError.Reset();
    TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
    Input->SetStringField(TEXT("revision"), Revision);
    FClusterWorkstationActionResponse Response;
    if (!RequestActionBlocking(TEXT("revision.materialize"), RepositoryId, {Path}, Input, Response, 30.0f) || !Response.Result.IsValid())
    {
        OutError = Response.ErrorMessage;
        return false;
    }
    const TSharedPtr<FJsonObject>* Object = nullptr;
    if (!Response.Result->TryGetObject(Object) || !Object || !Object->IsValid())
    {
        OutError = TEXT("Cluster Workstation returned an invalid revision materialization payload.");
        return false;
    }
    (*Object)->TryGetStringField(TEXT("materializedPath"), OutPath);
    if (OutPath.IsEmpty())
    {
        OutError = TEXT("Cluster Workstation did not return a materialized revision path.");
        return false;
    }
    return true;
}

bool FClusterWorkstationClient::StartOperationBlocking(
    const FString& RepositoryId,
    const TArray<FString>& Paths,
    const TSharedPtr<FJsonObject>& Input,
    FClusterWorkstationOperationSnapshot& OutOperation,
    FString& OutError) const
{
    FClusterWorkstationActionResponse Response;
    if (!RequestActionBlocking(TEXT("operation.start"), RepositoryId, Paths, Input, Response, 5.0f))
    {
        OutError = Response.ErrorMessage;
        return false;
    }
    return ParseWorkstationOperation(Response.Result, OutOperation, OutError);
}

bool FClusterWorkstationClient::GetOperationStatusBlocking(
    const FString& RepositoryId,
    const FString& OperationId,
    FClusterWorkstationOperationSnapshot& OutOperation,
    FString& OutError) const
{
    TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
    Input->SetStringField(TEXT("operationId"), OperationId);
    FClusterWorkstationActionResponse Response;
    if (!RequestActionBlocking(TEXT("operation.status"), RepositoryId, {}, Input, Response, 5.0f))
    {
        OutError = Response.ErrorMessage;
        return false;
    }
    return ParseWorkstationOperation(Response.Result, OutOperation, OutError);
}

bool FClusterWorkstationClient::CancelOperationBlocking(
    const FString& RepositoryId,
    const FString& OperationId,
    FClusterWorkstationOperationSnapshot& OutOperation,
    FString& OutError) const
{
    TSharedPtr<FJsonObject> Input = MakeShared<FJsonObject>();
    Input->SetStringField(TEXT("operationId"), OperationId);
    FClusterWorkstationActionResponse Response;
    if (!RequestActionBlocking(TEXT("operation.cancel"), RepositoryId, {}, Input, Response, 5.0f))
    {
        OutError = Response.ErrorMessage;
        return false;
    }
    return ParseWorkstationOperation(Response.Result, OutOperation, OutError);
}
