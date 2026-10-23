"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "./server";

export async function signOut(): Promise<void> {
  await getAuth().api.signOut({
    headers: await headers(),
  });
  redirect("/sign-in");
}
