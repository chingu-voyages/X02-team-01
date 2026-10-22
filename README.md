# voyagexp-tasks

Your project's `readme` is as important to success as your code. For 
this reason you should put as much care into its creation and maintenance
as you would any other component of the application.

If you are unsure of what should go into the `readme` let this article,
written by an experienced Chingu, be your starting point - 
[Keys to a well written README](https://tinyurl.com/yk3wubft).

And before we go there's "one more thing"! Once you decide what to include
in your `readme` feel free to replace the text we've provided here.

> Own it & Make it your Own!

## Getting Started: Configuration

Copy the env templates and fill in local values — `.env` is gitignored, never
commit it:

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env.local
```

See [docs/configuration.md](./docs/configuration.md) for the full variable
reference, container notes, and secrets rules.

## Branching and releases

Two long-lived branches:

- `dev` — integration branch. All feature PRs target this branch.
- `main` — production. Only receives release PRs from `dev`.

```text
feature/*  --PR-->  dev  --release PR-->  main  --CD--> production
```

- Open feature PRs against `dev`, never `main`.
- Before opening or updating a PR, merge `dev` into your branch and re-run tests.
- Release by opening a PR from `dev` to `main` and merging with a squash merge.
- Hotfix from `main`: branch from `main`, PR back to `main`, then merge `main`
  into `dev` so the fix is not lost.
- Do not push directly to `dev` or `main`; both are protected and require a PR.
- `cd-publish.yml` builds production images only from `main`.

CI runs on every pull request. The new-branch PR checks intentionally have no
path filters so required status checks always report. Run the backend suite
from `backend/`:

```bash
cd backend
pip install -r requirements.txt
pytest -q
```

PostgreSQL-backed constraint tests are opt-in with `RUN_DB_INTEGRATION=1`; wiring
that (and `alembic upgrade head` / `alembic check`) into CI is a follow-up.

## Team Documents

You may find these helpful as you work together to organize your project.

- [Team Project Ideas](./docs/team_project_ideas.md)
- [Team Decision Log](./docs/team_decision_log.md)

Meeting Agenda templates (located in the `/docs` directory in this repo):

- Meeting - Kickoff Agenda --> ./docs/meeting-voyage_kickoff.docx
- Meeting - App Vision & Feature Planning --> ./docs/meeting-vision_and_feature_planning.docx
- Meeting - Sprint Retrospective, Review, and Planning --> ./docs/meeting-sprint_retrospective_review_and_planning.docx
- Meeting - Sprint Open Topic Session --> ./docs/meeting-sprint_open_topic_session.docx

## Our Team

Everyone on your team should add their name along with a link to their GitHub
& optionally their LinkedIn profiles below. Do this in Sprint #1 to validate
your repo access and to practice PR'ing with your team *before* you start
coding!

- Yangchen Dema (Scrum Master): [GitHub](https://github.com/dema66) / [LinkedIn](https://www.linkedin.com/in/yangchendema/?isSelfProfile=true)
- Lilla Tóth: [GitHub](https://github.com/Lilla-ctrl) / [LinkedIn](https://www.linkedin.com/in/lillatoth216/)
- John Ezekiel: [GitHub](https://github.com/Sirius1616) / [LinkedIn](https://www.linkedin.com/in/john-ezekiel-dev/)
- Juan Guzman: [GitHub](https://github.com/Pi-face) / [LinkedIn](https://www.linkedin.com/in/juan-guzman-24536643b/)
- Elizabeth Aferi (Product Owner & Product Designer): [GitHub](https://github.com/eaferi) / [LinkedIn](https://linkedin.com/in/elizabeth-aferi)
   ...
- Teammate name #n: [GitHub](https://github.com/ghaccountname) / [LinkedIn](https://linkedin.com/in/liaccountname)
