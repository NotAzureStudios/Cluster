import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validPeopleStartDate, validPeopleTimeZone } from "../../apps/server/src/domains/users/people-input-validation.ts";
let count=0;
function test(name, fn) { fn(); count++; console.log("PASS", name); }
test("Valid leap year accepted",()=>assert.equal(validPeopleStartDate("2024-02-29"),true));
test("Invalid Feb 30 rejected without date normalization",()=>assert.equal(validPeopleStartDate("2026-02-30"),false));
test("Invalid month/day rejected",()=>{for(const s of ["2026-13-01","2026-11-31","2026-00-01","hello"])assert.equal(validPeopleStartDate(s),false,s);});
test("Real ISO timestamps accepted",()=>{assert.equal(validPeopleStartDate("2026-11-04T14:30:00Z"),true);assert.equal(validPeopleStartDate("2026-11-04T09:30:00-05:00"),true);});
test("Invalid timestamps rejected",()=>{for(const s of ["2026-11-04T99:30:00Z","2026-11-04T14:30:00","2026-11-4T14:30:00Z"])assert.equal(validPeopleStartDate(s),false,s);});
test("Valid IANA zones accepted",()=>{assert.equal(validPeopleTimeZone("America/New_York"),true);assert.equal(validPeopleTimeZone("UTC"),true);assert.equal(validPeopleTimeZone(""),true);});
test("Invalid IANA zone denied",()=>{assert.equal(validPeopleTimeZone("Mars/Olympus"),false);assert.equal(validPeopleTimeZone("x".repeat(110)),false);});
const source=readFileSync("apps/server/src/domains/users/user-directory-routes.ts","utf8");
test("Both create and update enforce strict profile date and time zone inputs",()=>{
  assert.equal(source.split("refine(validPeopleTimeZone").length-1,2);
  assert.equal(source.split("refine(validPeopleStartDate").length-1,2);
});
test("Both create and update bound notes and contact fields",()=>{
  for(const clause of ["notes: z.string().max(4000)", "phoneNumber: z.string().max(60)", "legalName: z.string().max(160)", "pronouns: z.string().max(160)"]){
    assert.equal(source.split(clause).length-1,2,clause);
  }
});
test("Role and lifecycle permission boundaries remain in user update route",()=>{
  assert.ok(source.includes("SCOPED_GRANT_REVIEW_REQUIRED"));
  assert.ok(source.includes("ACCESS_RENEWAL_GOVERNED"));
  assert.ok(source.includes("ROLE_PROFILE_REVISION_REQUIRED"));
});
console.log(`v1.1 people input validation: ${count} runtime and source checks passed.`);
