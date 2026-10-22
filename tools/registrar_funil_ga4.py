"""Confere ou registra os detalhes do funil no GA4; escrita exige --aplicar."""
import argparse
import json
from pathlib import Path

from google.analytics.admin_v1beta import AnalyticsAdminServiceClient
from google.analytics.admin_v1beta.types import CustomDimension
from google.api_core.exceptions import PermissionDenied
from google.oauth2 import service_account

PROPERTY = "properties/353205396"
DEFINITIONS = {
    "cta_position": "Posicao do botao",
    "form_kind": "Tipo de formulario",
    "reservation_stage": "Etapa da reserva",
    "reservation_reason": "Motivo do resultado da reserva",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aplicar", action="store_true")
    args = parser.parse_args()
    credential_path = Path(__file__).resolve().parents[2] / "site/tools/analytics/service_account.json"
    credentials = service_account.Credentials.from_service_account_file(
        str(credential_path), scopes=["https://www.googleapis.com/auth/analytics.edit"
                                     if args.aplicar else "https://www.googleapis.com/auth/analytics.readonly"],
    )
    client = AnalyticsAdminServiceClient(credentials=credentials)
    existing = {d.parameter_name: d for d in client.list_custom_dimensions(parent=PROPERTY)}
    for parameter, label in DEFINITIONS.items():
        if parameter in existing:
            if existing[parameter].scope != CustomDimension.DimensionScope.EVENT:
                raise SystemExit("Definicao existente com escopo diferente; preservada.")
            print(json.dumps({"parameter": parameter, "status": "already_registered"}))
            continue
        if not args.aplicar:
            print(json.dumps({"parameter": parameter, "status": "missing"}))
            continue
        try:
            client.create_custom_dimension(parent=PROPERTY, custom_dimension=CustomDimension(
                parameter_name=parameter, display_name=label,
                scope=CustomDimension.DimensionScope.EVENT,
                description="Detalhe do funil de reservas Sir Fisher; valores categoricos sem dados pessoais.",
            ))
        except PermissionDenied:
            print(json.dumps({"status": "permission_denied", "parameter": parameter,
                              "required_role": "Editor", "property": PROPERTY}))
            raise SystemExit(2)
        print(json.dumps({"parameter": parameter, "status": "created"}))
    registered = {d.parameter_name for d in client.list_custom_dimensions(parent=PROPERTY)}
    print(json.dumps({"registered": sorted(set(DEFINITIONS) & registered),
                      "missing": sorted(set(DEFINITIONS) - registered)}))


if __name__ == "__main__":
    main()
