// Production TS-only lifecycle validator loader for earlier AST extraction
// suites. This compiles the actual implementation, never a mock projector.
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const source=fs.readFileSync(new URL('../../packages/renderer/src/features/settings/msi-lifecycle-planning.ts',import.meta.url),'utf8');
const exposed={};
Function('exports',ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText)(exposed);
export const {validateMSILifecyclePlans,expectedMSILifecyclePlans}=exposed;
export const withMSILifecyclePlans=profile=>({...profile,lifecycleRecords:profile.lifecycleRecords||[],lifecyclePlans:expectedMSILifecyclePlans({...profile,lifecycleRecords:profile.lifecycleRecords||[]})});
