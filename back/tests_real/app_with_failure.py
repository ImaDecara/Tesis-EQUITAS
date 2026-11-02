"""La API real con una ruta que falla sin tratar: para mirar qué imprime uvicorn de verdad."""

from api.main import app


@app.get("/falla-sin-tratar")
def fails() -> None:
    raise RuntimeError("CENTINELA_A052_EXCEPCION")
