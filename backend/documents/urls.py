from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import DocumentoViewSet, TipoViewSet, session_view

router = DefaultRouter()
router.register("tipos", TipoViewSet)
router.register("documentos", DocumentoViewSet, basename="documento")
urlpatterns = [path("session/", session_view), path("", include(router.urls))]
