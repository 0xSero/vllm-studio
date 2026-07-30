import { acquireEnterpriseStateLease } from "../../src/lib/auth/enterprise-state-store";

const [, , scope] = process.argv;
if (!scope) throw new Error("Lease owner scope is missing");

await acquireEnterpriseStateLease(scope);
process.stdout.write("ready\n");
await new Promise(() => {});
