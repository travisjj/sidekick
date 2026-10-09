# Sidekick

This folder is a toolbox. Its skills act on other things (a browser, a service, another
repository) and are invoked from chats about other projects.

- Never treat Sidekick as the target of a task that belongs to another workspace folder. Do not
  edit files here unless the user is explicitly working on Sidekick itself.
- Skills write nothing into Sidekick or into any other workspace folder. Scratch space, if a
  skill ever needs it, goes under `.scratch/`, which is gitignored.
- Each skill is self-contained in `.cursor/skills/<name>/` and references its own files
  relative to that directory. No absolute paths.
