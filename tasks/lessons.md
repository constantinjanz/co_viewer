# Lessons

- Treat film identity as private content, not just credentials. A public generic
  viewer must keep titles out of HTML, JavaScript, metadata, documentation and
  public Git history. Render private content only after server authentication.
- Before changing repository visibility, audit semantic private content as well
  as tokens. Preserve an old private archive instead of publishing its history.

- The user explicitly does not want Vercel support contacted. Do not send the
  prepared draft or reopen that approval flow unless the user requests it.
- Check provider limits before large uploads. Removing a file does not guarantee
  a persisted usage/quota suspension clears; confirm real writes before claiming
  a smaller replacement will unblock deployment.
- A free allowance is not a zero-spend cap. When the user prohibits costs, inspect
  actual checkout and billing terms before activation. R2 requires a metered
  subscription; obtain an explicit decision instead of treating "$0 due now" as
  proof that future charges are impossible.
- Validate real browser requests and sustained sessions before release. Empty
  POST bodies can be streams, and compression can change strong ETags into weak
  validators once the state grows. Short mocked flows did not expose either.
- Verify Git author eligibility before uploading media to a new Hobby account.
  An authenticated account alone does not authorize a different private-repo
  author; preserve truthful provenance and use supported collaboration settings.
