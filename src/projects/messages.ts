export const PROJECT_PAGE_SIZE = 25;

export const FIELD_MESSAGES = {
  name: "Enter a name between 1 and 100 characters.",
  description: "Description must be 5000 characters or fewer.",
  id: "That project id is not valid.",
  confirm: "Deletion was not confirmed.",
  view: "Project view must be active or archived.",
  page: "Page must be a whole number of 1 or greater.",
} as const;

export const INVALID_FILTERS_MESSAGE = "Those project filters are not valid.";

export const EMPTY_ACTIVE_MESSAGE = "No active projects. Create one to get started.";

export const EMPTY_ARCHIVED_MESSAGE = "No archived projects.";

export const EMPTY_PAGE_MESSAGE = "No projects on this page.";

export const NOT_FOUND_HEADING = "Project not found";

export const NOT_FOUND_MESSAGE = "That project is not available.";

export const ARCHIVED_EDIT_MESSAGE = "This project is archived. Restore it before editing.";

export const UNAUTHENTICATED_MESSAGE = "Sign in to continue.";

export const GENERIC_INVALID_MESSAGE = "That project could not be saved.";

export const DELETE_PERMANENT_MESSAGE = "This permanently deletes the project. You cannot undo it.";

export const CHANGES_SAVED_MESSAGE = "Changes saved.";

export const PROJECT_ARCHIVED_MESSAGE = "Project archived.";

export const PROJECT_RESTORED_MESSAGE = "Project restored.";
