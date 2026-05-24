# backend/app/api/routes/screening_result.py
#
# Screening result endpoints - returns ML inference results to the frontend.
# All routes are protected - valid JWT token required.
# All authenticated roles can view results.

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.dependencies import get_current_user
from app.db.database import get_db
from app.models.user import User
from app.schemas.screening_result import ScreeningResultResponse, ScreeningWithResults
from app.services.screening_result_service import (
    get_results_by_screening,
    get_ensemble_result,
    get_screening_with_results,
)

router = APIRouter(prefix="/results", tags=["Screening Results"])


@router.get("/{screening_id}", response_model=list[ScreeningResultResponse], status_code=status.HTTP_200_OK)
async def get_all_results(
    screening_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return all model results for a screening.
    # Research Mode uses this to show side-by-side comparison.
    results = await get_results_by_screening(db, screening_id)
    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No results found for this screening."
        )
    return results


@router.get("/{screening_id}/ensemble", response_model=ScreeningResultResponse, status_code=status.HTTP_200_OK)
async def get_clinical_result(
    screening_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return only the ensemble result for a screening.
    # Clinical Mode uses this as the authoritative output.
    result = await get_ensemble_result(db, screening_id)
    if not result:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Ensemble result not found for this screening."
        )
    return result


@router.get("/{screening_id}/full", response_model=ScreeningWithResults, status_code=status.HTTP_200_OK)
async def get_full_screening_results(
    screening_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Return screening record with all results combined.
    # Used for the full clinical results page in the frontend.
    data = await get_screening_with_results(db, screening_id)
    if not data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Screening not found."
        )
    return data