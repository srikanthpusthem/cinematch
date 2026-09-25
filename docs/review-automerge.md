# Review-triggered auto-merge

CineMatch uses a machine-readable review marker because the current agent reviews
and pull requests share the repository owner's GitHub identity. GitHub therefore
records the agent review as a comment instead of a formal approval.

## Approving a pull request

Review the current pull request head and confirm that it is ready to merge. Submit
the review from the repository owner's account with this exact marker as the final
characters of the review body:

```text
<!-- cinematch-review:approve -->
```

The marker is a release instruction. Include it only when there are no blocking
findings. The workflow accepts it only from the repository owner, only for the
exact commit reviewed, and only while the pull request is not a draft. It arms
GitHub's squash auto-merge; required branch checks and resolved conversations still
gate the actual merge.

The workflow does not check out or execute pull-request code. It reads pull-request
metadata through GitHub's API and uses the event token only to manage auto-merge.

## Changes after approval

A new commit, reopening the pull request, changing it to draft, or marking it ready
for review clears an earlier auto-merge request. Review the new head and submit a
new review ending with the approval marker to arm auto-merge again.

Any later owner review without the approval marker also clears an armed auto-merge
request. Use a normal review without the marker when requesting changes or
withdrawing approval.

## Repository prerequisites

Repository auto-merge must be enabled. The `main` branch must require the `ci`
status check and require all review conversations to be resolved. These repository
settings remain the final safeguards after the marker arms auto-merge.
