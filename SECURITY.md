# Security policy

## What counts as a security issue here

This project publishes data and a pure computation library, so the usual web
attack surface is absent. Two classes of problem matter instead:

1. **An incorrect framework file that is being relied upon.** An outcome
   statement that does not match the official manual can propagate into an
   accreditation submission. Treat this as a security issue, not a bug report,
   if you believe institutions are already depending on it.
2. **Real data in the repository.** Any student data, roll numbers, marks, email
   addresses or institutional rubric that has been committed — including in git
   history. Report privately and do not open a public issue.

Also in scope: dependency vulnerabilities in the published packages, and any way
to make the engine execute I/O, read the clock, or otherwise behave
non-deterministically.

## Reporting

Report privately to **<ebindeniraj@iiitkottayam.ac.in>** rather than opening a
public issue. Include what you found, where, and how you verified it.

You can expect acknowledgement within 14 days, in line with `MAINTENANCE.md`.

## Out of scope

This repository contains no server, no authentication and no network code. The
application that consumes these packages is maintained separately and privately;
issues in it should not be reported here.

## Disclosure

For an incorrect framework file we will publish the correction and a changelog
entry naming what was wrong and for how long, because institutions need to know
whether a submission they already made was affected. Credit is given unless you
ask otherwise.
