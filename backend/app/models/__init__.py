# Import all models here so SQLAlchemy can discover them.
# Add new models here when created.

from app.models.user import User
from app.models.patient import Patient
from app.models.screening import Screening
from app.models.screening_result import ScreeningResult
from app.models.user_tokens import UserTokens
from app.models.system_settings import SystemSettings
from app.models.report_history import ReportHistory