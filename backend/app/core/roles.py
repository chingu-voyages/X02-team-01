"""The three supported JHEP-26 account roles.

These values are a shared contract, not an authorization check. A later
checkpoint will load the account from the database and enforce permissions.
"""

from enum import StrEnum


class UserRole(StrEnum):
    LEARNER = "learner"
    CONTRIBUTOR = "contributor"
    ADMINISTRATOR = "administrator"
