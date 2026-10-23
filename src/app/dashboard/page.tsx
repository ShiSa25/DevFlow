import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requirePilot } from "../../auth/server";
import { PILOT_NOT_APPROVED_CODE } from "../../auth/messages";
import { PilotNav } from "../pilot-nav";

async function DashboardSession() {
  const admission = await requirePilot(await headers());
  if (admission.status === "unauthenticated") {
    redirect("/sign-in");
  }
  if (admission.status === "unapproved") {
    redirect(`/sign-in?error=${PILOT_NOT_APPROVED_CODE}`);
  }

  return (
    <main>
      <h1>Dashboard</h1>
      <p>Signed in as {admission.user.name}.</p>
      <PilotNav current="dashboard" />
    </main>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardSession />
    </Suspense>
  );
}
