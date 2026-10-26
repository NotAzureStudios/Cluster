#pragma once

#include "Modules/ModuleManager.h"

class FClusterSourceControlProvider;

class FClusterSourceControlModule final : public IModuleInterface
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;

private:
    TUniquePtr<FClusterSourceControlProvider> Provider;
};
