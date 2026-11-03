import { __test_loadOffseasonTransactionArchive as loadOffseasonTransactionArchive, __test_computeOffseasonArchiveMonths as computeOffseasonArchiveMonths } from "../src/services/snapshotBuilder_verify.mjs";

console.log("months:", computeOffseasonArchiveMonths(new Date("2034-08-18T00:00:00Z")));

const result = loadOffseasonTransactionArchive("200", new Date("2034-08-18T00:00:00Z"), []);
console.log("result length (leagueId='200', no live transactions):", result.length);
