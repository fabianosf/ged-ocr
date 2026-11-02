import os

if os.getenv("GED_E2E_TEST_MODE") != "1":
    raise RuntimeError("E2E settings require GED_E2E_TEST_MODE=1.")

from .test_settings import *  # noqa: E402,F403

DATABASES = {"default": {
    "ENGINE": "django.db.backends.sqlite3",
    "NAME": os.environ["GED_E2E_DATABASE"],
}}
MEDIA_ROOT = os.environ["GED_E2E_MEDIA"]
ALLOWED_HOSTS = ["127.0.0.1", "localhost"]
CSRF_TRUSTED_ORIGINS = ["http://127.0.0.1:5175"]
CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BROKER_URL = "memory://"
LLM_API_KEY = "e2e-synthetic-only"
LLM_MODEL = "e2e-synthetic-only"
GED_URL = ""
