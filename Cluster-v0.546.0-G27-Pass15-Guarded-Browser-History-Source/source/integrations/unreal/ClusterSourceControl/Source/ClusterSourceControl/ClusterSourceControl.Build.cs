using UnrealBuildTool;

public class ClusterSourceControl : ModuleRules
{
    public ClusterSourceControl(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "SourceControl"
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "CoreUObject",
            "Engine",
            "HTTP",
            "Json",
            "JsonUtilities",
            "Projects",
            "Slate",
            "SlateCore",
            "UnrealEd"
        });
    }
}
