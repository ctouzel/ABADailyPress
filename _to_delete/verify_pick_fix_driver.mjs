import { __test_buildRandomTeamNumberOnePicks, __test_findTrueFirstDraftPick } from "./src/services/snapshotBuilder_verify_pick_fix.mjs";

function assert(cond, msg) {
  console.log((cond ? "OK: " : "FAIL: ") + msg);
}

// 1. Direct check of the new cross-reference helper against the real 2033 transaction log.
const truePick2033 = __test_findTrueFirstDraftPick("200", "42", "2033");
console.log("findTrueFirstDraftPick(200, 42, 2033) =", JSON.stringify(truePick2033));
assert(truePick2033?.playerId === "2131", "2033 true first pick is player 2131 (Harper Jenkins)");
assert(truePick2033?.playerName === "Harper Jenkins", "2033 true first pick name is 'Harper Jenkins'");
assert(truePick2033?.didNotSign === true, "2033 true first pick is flagged didNotSign");

const truePick2034 = __test_findTrueFirstDraftPick("200", "42", "2034");
console.log("findTrueFirstDraftPick(200, 42, 2034) =", JSON.stringify(truePick2034));
assert(truePick2034?.playerName === "Ricky Rumble", "2034 true first pick is Ricky Rumble (already correct in the grid)");
assert(truePick2034?.didNotSign === false, "2034 true first pick signed");

// 2. End-to-end: force team 42 (Albuquerque) selection by making it the only "active" team.
const standingsSections = [
  { rows: [{ Team: "Albuquerque Isotopes" }] },
];
const feature = __test_buildRandomTeamNumberOnePicks(standingsSections, "200");
console.log("\nbuildRandomTeamNumberOnePicks ->", JSON.stringify(feature, null, 2));

assert(feature?.teamId === "42", "selected team is Albuquerque (42)");
const pick2033 = feature?.picks?.find((p) => p.year === "2033");
assert(pick2033?.player === "Harper Jenkins", "end-to-end: 2033 pick overridden to Harper Jenkins");
assert(pick2033?.didNotSign === true, "end-to-end: 2033 pick flagged didNotSign");
assert(pick2033?.position === "LF", "end-to-end: 2033 pick position pulled from player's own profile page");
assert(pick2033?.currentTeam === "Midland RockHounds (ALB)", "end-to-end: 2033 pick currentTeam reflects where he ended up");

const pick2034 = feature?.picks?.find((p) => p.year === "2034");
assert(pick2034?.player === "Ricky Rumble", "end-to-end: 2034 pick unchanged (grid already correct)");
assert(pick2034?.didNotSign === false, "end-to-end: 2034 pick not flagged");

console.log("\nDone.");
