#!/usr/bin/env bash
# Falla el build si reaparece copy que contradice los hechos inmutables.
set -euo pipefail
PATTERN='[Gg]ratis|[Ss]in tarjeta|/mes|CLP / mes|[Cc]ancela cuando quieras|[Cc]ancela con un clic|[Ss]in contratos|avisamos por WhatsApp|por correo y WhatsApp'
TARGETS="src/app/page.tsx src/components/marketing src/app/empieza src/components/app"
if grep -rnE "$PATTERN" $TARGETS; then
  echo "ERROR: copy prohibido encontrado (paywall activo, Pro sin cobro automático)."
  exit 1
fi
echo "OK: copy limpio."
