import { deleteEnterpriseSessionsForLogout } from "../../src/lib/auth/enterprise-session";

const [, , issuer, issuerId, subject, sid, jti] = process.argv;
if (!issuer || !issuerId || !subject || !sid || !jti) {
  throw new Error("Logout worker arguments are incomplete");
}

const result = await deleteEnterpriseSessionsForLogout(
  issuer,
  issuerId,
  jti,
  Date.now() + 120_000,
  {
    subject,
    sid,
  },
);
process.stdout.write(JSON.stringify(result));
