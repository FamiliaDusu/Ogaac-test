# Guía: Configurar OBS WebSocket en DVR-Cicero

## Requisitos
- OBS Studio 28+ (ya incluye WebSocket)
- Acceso al equipo DVR-Cicero-XX

## Pasos de Configuración

### 1. Abrir OBS Studio
En el equipo DVR-Cicero, abrir OBS Studio.

### 2. Acceder a Configuración WebSocket
- Ir a **Herramientas** → **Configuración del servidor WebSocket**
- O en inglés: **Tools** → **WebSocket Server Settings**

### 3. Configurar el Servidor
```
☑ Habilitar servidor WebSocket
Puerto: 4455
☐ Habilitar autenticación (DESMARCAR para pruebas)
```

### 4. Aplicar y Reiniciar OBS
- Click en **Aplicar** y **Aceptar**
- Reiniciar OBS Studio

### 5. Verificar desde obs1
Ejecutar el script de verificación:
```bash
/var/www/ogaac-test/tools/check-dvr-websocket.sh
```

## Solución de Problemas

### Puerto Cerrado
- Verificar que OBS esté ejecutándose
- Verificar Firewall de Windows:
  - Panel de Control → Firewall → Permitir aplicación → OBS Studio

### Sin Respuesta (Offline)
- Verificar conectividad de red
- Hacer ping desde el servidor: `ping 10.64.XXX.XX`

## Tabla de IPs

| Hostname | IP | Sala |
|----------|-----|------|
| dvr-cicero-57 | 10.7.203.55 | Tacuari Sala 3 |
| dvr-cicero-58 | 10.64.202.55 | Suipacha Sala 8 |
| dvr-cicero-59 | 10.64.204.61 | Suipacha Sala 9 |
| dvr-cicero-60 | 10.64.207.55 | Suipacha Sala 1 |
| dvr-cicero-61 | 10.64.205.58 | Suipacha Sala 3 |
| dvr-cicero-64 | 10.7.206.55 | Tacuari Sala 6 |
| dvr-cicero-72 | 10.64.201.55 | Suipacha Sala 4 |
| dvr-cicero-73 | 10.46.201.55 | Yrigoyen Sala 1 |
| dvr-cicero-74 | 10.7.209.55 | Tacuari Sala 9 |
| dvr-cicero-76 | 10.7.204.55 | Tacuari Sala 4-5 |
| dvr-cicero-77 | 10.64.206.55 | Suipacha Sala 10 |
| dvr-cicero-78 | 10.7.208.55 | Tacuari Sala 8 |
