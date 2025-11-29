from urllib.parse import quote


def build_chart_url(
    company_id: str | int,
    metrics: list[str] | str,
    *,
    days: int = 365,
    consolidated: bool = True,
) -> str:
    """
    Build a Screener /chart/ API URL.
    """
    if isinstance(metrics, list):
        metrics = "-".join(metrics)

    metrics_encoded = quote(metrics)
    consolidated_str = "true" if consolidated else "false"

    return (
        f"https://www.screener.in/api/company/{company_id}/chart/"
        f"?q={metrics_encoded}&days={days}&consolidated={consolidated_str}"
    )


def build_schedule_url(
    company_id: str | int,
    *,
    parent: str,
    section: str = "quarters",
    consolidated: bool = True,
) -> str:
    """
    Build Screener /schedules/ API URL.
    """
    parent_encoded = quote(parent)
    consolidated_str = "true" if consolidated else "false"

    return (
        f"https://www.screener.in/api/company/{company_id}/schedules/"
        f"?parent={parent_encoded}&section={section}&consolidated={consolidated_str}"
    )


def build_peers_url(warehouse_id: str | int) -> str:
    """
    Build Screener /peers/ API URL (uses warehouse_id).
    """
    return f"https://www.screener.in/api/company/{warehouse_id}/peers/"

