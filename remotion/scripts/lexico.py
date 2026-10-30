"""Léxico local del planificador: qué se ilustra, con qué componente y en qué contexto no.

Las formas van normalizadas (minúsculas, sin tildes). Los íconos son de Tabler (MIT) y se validan
contra node_modules al cargar; uno que no exista se ignora en lugar de romper el plan.
"""

from __future__ import annotations

# Sustantivos concretos -> ícono Tabler (outline).
ICONOS = {
    ("avion", "aviones"): "plane",
    ("aeropuerto",): "plane-departure",
    ("carro", "carros", "auto", "coche", "coches"): "car",
    ("moto", "motos"): "motorbike",
    ("bicicleta", "bici"): "bike",
    ("tren",): "train",
    ("bus", "buses"): "bus",
    ("barco", "barcos"): "ship",
    ("cohete",): "rocket",
    ("casa", "casas", "hogar"): "home",
    ("edificio",): "building",
    ("ciudad",): "building-skyscraper",
    ("oficina",): "briefcase",
    ("colegio", "escuela", "universidad"): "school",
    ("hospital",): "building-hospital",
    ("medico", "doctor", "doctora"): "stethoscope",
    ("banco",): "building-bank",
    ("tienda",): "building-store",
    ("dinero", "billete", "billetes", "efectivo"): "cash",
    ("tarjeta",): "credit-card",
    ("compras", "carrito"): "shopping-cart",
    ("regalo", "regalos"): "gift",
    ("cafe",): "coffee",
    ("cerveza",): "beer",
    ("vino",): "glass-full",
    ("pizza",): "pizza",
    ("computador", "computadora", "portatil", "laptop"): "device-laptop",
    ("celular", "movil", "telefono"): "device-mobile",
    ("camara",): "camera",
    ("foto", "fotos", "fotografia"): "photo",
    ("video", "videos"): "video",
    ("musica", "cancion", "canciones"): "music",
    ("audifonos",): "headphones",
    ("libro", "libros"): "book",
    ("biblia", "biblias"): "bible",
    ("correo", "email"): "mail",
    ("mensaje", "mensajes", "chat"): "message",
    ("reloj",): "clock",
    ("alarma",): "alarm",
    ("calendario",): "calendar",
    ("idea", "ideas"): "bulb",
    ("corazon",): "heart",
    ("fuego",): "flame",
    ("sol",): "sun",
    ("lluvia",): "cloud-rain",
    ("playa",): "beach",
    ("montana", "montanas"): "mountain",
    ("arbol", "arboles"): "tree",
    ("perro", "perros"): "dog",
    ("gato", "gatos"): "cat",
    ("pelota", "balon", "futbol"): "ball-football",
    ("gimnasio", "pesas"): "barbell",
    ("internet",): "world-www",
    ("wifi",): "wifi",
    ("contrasena", "candado"): "lock",
    ("llave", "llaves"): "key",
    ("grafico", "ventas"): "chart-line",
    ("meta", "objetivo"): "target",
}

# Contextos que cambian el sentido de una palabra (ventana de ±N palabras).
CONTEXTO_MUSICAL = {"musical", "piano", "organo", "sintetizador", "tocar", "toco", "tocando", "nota", "notas", "acorde", "acordes"}
CONTEXTO_ESCRITURA_RAICES = ("escrib", "tecle", "tipe", "digit", "redact")
CONTEXTO_ESCRITURA = {"computador", "computadora", "portatil", "mensaje", "correo", "chat", "texto"}
CONTEXTO_LANZAMIENTO_RAICES = ("lanz", "tir", "volad")
CONTEXTO_LANZAMIENTO = {"cara", "sello", "aire", "azar", "suerte"}
CONTEXTO_DINERO_RAICES = ("cost", "pag", "ahorr", "cobr", "gast", "compr", "vend")
CONTEXTO_DINERO = {"precio", "precios", "dinero", "valor", "cambio", "dolar", "dolares", "peso", "pesos", "euro", "euros", "banco", "economia"}
CONTEXTO_DEPORTE = {"copa", "mundial", "liga", "titulo", "torneo", "campeonato", "final", "partido", "medalla"}
TELEFONO = {"telefono", "celular", "movil"}
PERSONAS_DE_LLAMADA = {
    "amigo", "amiga", "mama", "papa", "madre", "padre", "jefe", "jefa", "novio", "novia", "esposo", "esposa",
    "hermano", "hermana", "abuelo", "abuela", "hijo", "hija", "tio", "tia", "primo", "prima", "cliente", "doctor", "doctora",
}

# Cifras: palabras de magnitud y unidades que vuelven relevante un número.
MAGNITUDES = {"cien", "mil", "millon", "millones", "billon", "billones"}
UNIDADES = {
    "porciento", "dolares", "dolar", "pesos", "euros", "anos", "kilos", "kilometros", "horas", "minutos",
    "personas", "seguidores", "veces", "metros", "dias", "semanas", "meses",
}
CONTEXTO_VERIFICAR_CIFRA = {
    "dolar", "dolares", "pesos", "euros", "inflacion", "pib", "impuesto", "impuestos", "votos", "elecciones",
    "presidente", "gobierno", "encuesta", "salario", "precio", "precios", "economia", "desempleo", "deuda", "porciento",
}

# Alias de países que no están entre los nombres de Natural Earth.
ALIAS_PAISES = {
    "eeuu": "USA", "ee uu": "USA", "usa": "USA", "estados unidos de america": "USA",
    "inglaterra": "GBR", "escocia": "GBR", "gales": "GBR", "gran bretana": "GBR",
    "holanda": "NLD", "chequia": "CZE", "republica checa": "CZE", "costa de marfil": "CIV",
    "congo": "COG", "corea": "KOR",
}
