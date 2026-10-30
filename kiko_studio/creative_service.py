"""Inteligencia creativa determinista y local para Kiko Studio IA."""

from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass
from typing import Any, Mapping, Optional, Union

from .trends import TrendRecord


def _clean(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s no puede estar vacío" % name)
    return " ".join(value.split())


@dataclass(frozen=True)
class CreativePackage:
    title: str
    ideas: tuple[Mapping[str, str], ...]
    hooks: tuple[str, ...]
    script: tuple[Mapping[str, str], ...]
    recording_notes: tuple[str, ...]
    cta: str
    source_url: str
    generation_mode: str = "deterministic_local"
    requires_editorial_review: bool = True

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class CreativeService:
    """Genera piezas repetibles sin red, modelo o afirmaciones inventadas."""

    _OPENERS = (
        "Antes de seguir esta tendencia, hazte esta pregunta:",
        "Esto puede parecer una moda, pero hay una decisión útil detrás:",
        "Si estás construyendo una marca, mira esto con criterio:",
        "La oportunidad no es copiar la tendencia, sino entenderla:",
    )

    def generate(
        self,
        trend: Union[TrendRecord, Mapping[str, Any]],
        *,
        audience: str = "emprendedores y creadores",
        objective: str = "convertir una tendencia en una acción aplicable",
        brand_name: str = "Kiko Orator",
    ) -> CreativePackage:
        if not isinstance(trend, TrendRecord):
            trend = TrendRecord.from_mapping(trend)
        trend.validated()
        audience = _clean(audience, "audience")
        objective = _clean(objective, "objective")
        brand_name = _clean(brand_name, "brand_name")
        topic = _clean(trend.topic, "topic")

        seed = "%s|%s|%s" % (topic.casefold(), audience.casefold(), objective.casefold())
        opener = self._OPENERS[int(hashlib.sha256(seed.encode("utf-8")).hexdigest(), 16) % len(self._OPENERS)]

        hooks = (
            "%s ¿qué cambia realmente con %s?" % (opener, topic),
            "Tres preguntas para decidir si %s merece tu tiempo." % topic,
            "No copies %s: conviértelo en una decisión para tu marca." % topic,
        )
        ideas = (
            {
                "title": "%s explicado sin humo" % topic.capitalize(),
                "angle": "Separar lo comprobado, lo interpretable y lo que aún falta verificar.",
            },
            {
                "title": "La prueba práctica de %s" % topic,
                "angle": "Aplicar la idea a un caso pequeño y medir antes de escalar.",
            },
            {
                "title": "Cuándo no usar %s" % topic,
                "angle": "Mostrar límites y criterios de decisión para la audiencia.",
            },
        )
        script = (
            {"section": "hook", "text": hooks[0]},
            {
                "section": "context",
                "text": (
                    "Encontré una referencia sobre %s publicada por %s en %s. "
                    "La fuente queda enlazada para revisar el contexto completo."
                    % (topic, trend.creator, trend.platform)
                ),
            },
            {
                "section": "value",
                "text": (
                    "Para %s, no basta con repetir la tendencia. Primero confirma qué "
                    "problema resuelve; después prueba una versión pequeña; por último "
                    "mide una señal que puedas observar." % audience
                ),
            },
            {
                "section": "application",
                "text": (
                    "El objetivo es %s. Conserva solo lo que encaje con tu audiencia "
                    "y documenta el resultado antes de convertirlo en una regla." % objective
                ),
            },
            {
                "section": "close",
                "text": "La tendencia aporta una hipótesis; tu prueba aporta la evidencia.",
            },
        )
        return CreativePackage(
            title="%s: una lectura práctica para %s" % (topic.capitalize(), audience),
            ideas=ideas,
            hooks=hooks,
            script=script,
            recording_notes=(
                "Plano medio vertical con audio limpio.",
                "Mostrar la URL de referencia al presentar el contexto.",
                "Usar texto en pantalla solo para los tres pasos verificables.",
                "No mostrar cifras que no estén respaldadas por la referencia.",
            ),
            cta="%s: ¿qué prueba pequeña harías primero?" % brand_name,
            source_url=trend.url,
        )

