import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(relative)=>readFileSync(new URL('../../'+relative,import.meta.url),'utf8');
const settings=read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
const client=read('packages/renderer/src/features/notifications/notification-preferences.ts');
const shared=read('packages/shared/src/notification-quiet-hours.ts');
const server=read('apps/server/src/domains/notifications/notification-policy.ts');
const lifecycle=read('apps/server/src/domains/notifications/notification-lifecycle.ts');
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS '+name)};
check('Settings names the member timezone used for quiet hours',()=>{
 assert.match(settings,/Quiet hours use your Profile timezone \(\{currentUser\.timezone \|\| "UTC when unset"\}\)/);
 assert.match(settings,/not this device’s clock/);
});
check('Settings does not promise impossible complete muting of critical security evidence',()=>{
 assert.match(settings,/<option value="silent">Mute routine interruptions<\/option>/);
 assert.match(settings,/Critical security notifications always interrupt/);
 assert.doesNotMatch(settings,/Everything becomes silent/);
});
check('client and server share a single clock implementation',()=>{
 assert.match(client,/notificationQuietHoursForZone\(rawPreferences\(source\), timeZone \|\| directZone \|\| "UTC", now\)/);
 assert.match(server,/notificationQuietHoursForZone\(preferences, user\?\.workingPattern\?\.timezone \|\| "UTC", now\)/);
 assert.doesNotMatch(server,/new Intl\.DateTimeFormat/);
 assert.match(shared,/timeZone: timeZone \|\| "UTC"/);
});
check('digest suppression shares the same server quiet-hours authority',()=>{
 assert.match(lifecycle,/import \{ notificationQuietHoursActive \} from "\.\/notification-policy\.js"/);
 assert.match(lifecycle,/notificationQuietHoursActive\(user, now\)/);
});
console.log(`${count}/${count} G27 P62 notification Settings and digest checks passed`);
