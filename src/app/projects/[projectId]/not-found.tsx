import Link from "next/link";
import { NOT_FOUND_HEADING, NOT_FOUND_MESSAGE } from "../../../projects/messages";

export default function ProjectNotFound() {
  return (
    <main>
      <h1>{NOT_FOUND_HEADING}</h1>
      <p>{NOT_FOUND_MESSAGE}</p>
      <Link href="/projects">Back to projects</Link>
    </main>
  );
}
