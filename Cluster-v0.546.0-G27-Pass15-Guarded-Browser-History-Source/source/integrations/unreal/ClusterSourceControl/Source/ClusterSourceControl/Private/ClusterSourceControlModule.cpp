#include "ClusterSourceControlModule.h"
#include "ClusterSourceControlProvider.h"
#include "Features/IModularFeatures.h"
#include "Modules/ModuleManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogClusterSourceControl, Log, All);

void FClusterSourceControlModule::StartupModule()
{
    Provider = MakeUnique<FClusterSourceControlProvider>();
    IModularFeatures::Get().RegisterModularFeature(TEXT("SourceControl"), Provider.Get());
    UE_LOG(LogClusterSourceControl, Log, TEXT("Cluster Source Control provider registered. Git execution and credentials remain owned by Cluster Desktop Workstation."));
}

void FClusterSourceControlModule::ShutdownModule()
{
    if (Provider)
    {
        Provider->Close();
        IModularFeatures::Get().UnregisterModularFeature(TEXT("SourceControl"), Provider.Get());
        Provider.Reset();
    }
}

IMPLEMENT_MODULE(FClusterSourceControlModule, ClusterSourceControl)
