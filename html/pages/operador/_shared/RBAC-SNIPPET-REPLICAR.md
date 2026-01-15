# RBAC: Guía de Replicación

> ⚠️ **ESTE ARCHIVO ES SOLO DOCUMENTACIÓN**
> 
> - NO contiene código ejecutable
> - NO se debe cargar en páginas HTML con `<script>`
> - Servir como referencia para replicar RBAC a otras salas

## Propósito

- Proveer snippets copiables
- Documentar el proceso de implementación paso a paso
- Facilitar la replicación a sala02-sala10

---

## PASO 1: Agregar scripts en el `<head>`

Buscar en el HTML:
```html
<script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
```

Agregar DESPUÉS:
```html
<script src="/operador/_shared/auth-rbac.js"></script>
```

---

## PASO 2: Agregar badge de usuario en header

Buscar:
```html
<div class="header-right">
  <button class="btn-logout" type="button" onclick="ogaacLogout()">Cerrar sesión</button>
</div>
```

Reemplazar por:
```html
<div class="header-right">
  <span id="user-badge" style="margin-right:12px;font-size:13px;opacity:0.9;">Cargando...</span>
  <button class="btn-logout" type="button" onclick="ogaacLogout()">Cerrar sesión</button>
</div>
```

---

## PASO 3: Agregar data-permission a controles

### Panel de Grabación/Audiencia

Buscar:
```html
<article class="card card-audright">
  <div class="panel-head">
    <div class="panel-title">Audiencia · Grabación</div>
```

Agregar `data-permission`:
```html
<article class="card card-audright" data-permission="control:recording">
  <div class="panel-head">
    <div class="panel-title">Audiencia · Grabación</div>
```

### Panel de Control OBS

Buscar:
```html
<article class="card card-obsright">
  <div class="panel-head">
    <div class="panel-title">Control OBS</div>
```

Agregar `data-permission`:
```html
<article class="card card-obsright" data-permission="control:obs">
  <div class="panel-head">
    <div class="panel-title">Control OBS</div>
```

### Link Avanzado

Buscar:
```html
<a id="obsAdvancedLink" href="..." target="_blank">Avanzado</a>
```

Agregar `data-permission`:
```html
<a id="obsAdvancedLink" href="..." target="_blank" data-permission="view:advanced">Avanzado</a>
```

### Controles de Audio (si existen)

Buscar:
```html
<button onclick="muteAudio()">Silenciar</button>
```

Agregar `data-permission`:
```html
<button onclick="muteAudio()" data-permission="control:audio">Silenciar</button>
```

---

## Ejemplo Completo de Sala

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Operador · Suipacha · Sala XX</title>
  
  <link rel="stylesheet" href="/ogaac.css" />
  <link rel="stylesheet" href="/css/sala-stream.css" />
  <link rel="stylesheet" href="/operador/_shared/css/control-room.css">
  
  <script src="https://cdn.jsdelivr.net/npm/hls.js@latest"></script>
  
  <!-- ✅ AGREGAR ESTO -->
  <script src="/operador/_shared/auth-rbac.js"></script>
</head>

<body class="page stream-page">

<header class="ogaac-header header-control-room">
  <div class="header-left">
    <div class="ogaac-brand-title">OGAAC · Salas en vivo</div>
  </div>

  <div class="header-center">SUIPACHA · SALAXX</div>

  <div class="header-right">
    <!-- ✅ AGREGAR BADGE -->
    <span id="user-badge" style="margin-right:12px;font-size:13px;opacity:0.9;">Cargando...</span>
    <button class="btn-logout" type="button" onclick="ogaacLogout()">Cerrar sesión</button>
  </div>
</header>

<main class="page-main">
  <div class="content-inner">
    
    <div class="control-grid">
      
      <!-- VIDEO: siempre visible (NO agregar data-permission) -->
      <article class="card card-stream">
        <div class="video-wrap">
          <video id="video" controls autoplay muted playsinline></video>
        </div>
        <div class="status-row">
          <span id="statusTag" class="status-tag">Cargando...</span>
          <span id="status">Conectando al servidor...</span>
        </div>
      </article>
      
      <!-- GRABACIÓN: ✅ agregar data-permission -->
      <article class="card card-audright" data-permission="control:recording">
        <div class="panel-head">
          <div class="panel-title">Audiencia · Grabación</div>
        </div>
        
        <div class="aud-box">
          <button>Iniciar grabación</button>
          <button>Detener grabación</button>
        </div>
      </article>
      
      <!-- OBS: ✅ agregar data-permission -->
      <article class="card card-obsright" data-permission="control:obs">
        <div class="panel-head">
          <div class="panel-title">Control OBS</div>
          <span id="obsApiStatus" class="pill">OBS: ...</span>
          <a id="obsAdvancedLink" href="..." data-permission="view:advanced">Avanzado</a>
        </div>
        
        <iframe src="/web-socket-obs/basic.html?sede=suipacha&sala=salaXX"></iframe>
      </article>
      
    </div>
    
  </div>
</main>

<script>
  const OGAAC_SEDE = "suipacha";
  const OGAAC_SALA = "salaXX"; // Cambiar por sala01, sala02, etc.
  window.OGAAC = { sede: OGAAC_SEDE, sala: OGAAC_SALA };
</script>

<script src="/operador/_shared/panel.js"></script>

</body>
</html>
```

---

## Script Bash para Replicar a Todas las Salas

Guardar como `replicar-rbac-salas.sh`:

```bash
#!/bin/bash
# replicar-rbac-salas.sh
# Script para agregar RBAC a todas las salas de Suipacha

SALAS="sala02 sala03 sala04 sala05 sala06 sala07 sala08 sala09 sala10"
BASE="/var/www/ogaac-test/html/pages/operador/suipacha"

for SALA in $SALAS; do
  HTML="$BASE/$SALA/index.html"
  
  if [ ! -f "$HTML" ]; then
    echo "⚠️  $SALA: archivo no encontrado"
    continue
  fi
  
  echo "📝 Procesando $SALA..."
  
  # Backup
  cp "$HTML" "$HTML.bak.rbac"
  
  # 1. Agregar script RBAC (si no existe)
  if ! grep -q "auth-rbac.js" "$HTML"; then
    sed -i '/<script src="https:\/\/cdn.jsdelivr.net\/npm\/hls.js/a\  <script src="/operador/_shared/auth-rbac.js"></script>' "$HTML"
    echo "   ✅ Script RBAC agregado"
  else
    echo "   ⏭️  Script RBAC ya existe"
  fi
  
  # 2. Agregar badge (si no existe)
  if ! grep -q 'id="user-badge"' "$HTML"; then
    sed -i 's/<button class="btn-logout"/<span id="user-badge" style="margin-right:12px;font-size:13px;opacity:0.9;">Cargando...<\/span>\n    <button class="btn-logout"/' "$HTML"
    echo "   ✅ Badge de usuario agregado"
  else
    echo "   ⏭️  Badge ya existe"
  fi
  
  # 3. Agregar data-permission a panel de audiencia
  if ! grep -q 'card-audright.*data-permission' "$HTML"; then
    sed -i 's/class="card card-audright"/class="card card-audright" data-permission="control:recording"/' "$HTML"
    echo "   ✅ data-permission en audiencia"
  else
    echo "   ⏭️  data-permission audiencia ya existe"
  fi
  
  # 4. Agregar data-permission a panel OBS
  if ! grep -q 'card-obsright.*data-permission' "$HTML"; then
    sed -i 's/class="card card-obsright"/class="card card-obsright" data-permission="control:obs"/' "$HTML"
    echo "   ✅ data-permission en OBS"
  else
    echo "   ⏭️  data-permission OBS ya existe"
  fi
  
  echo "   ✅ $SALA completado"
  echo ""
done

echo "🎉 RBAC replicado a todas las salas"
echo "💾 Backups guardados con extensión .bak.rbac"
```

---

## Verificación Post-Implementación

### 1. Script RBAC cargado
```bash
grep -n "auth-rbac.js" /var/www/ogaac-test/html/pages/operador/suipacha/sala*/index.html
```

### 2. Badge agregado
```bash
grep -n 'id="user-badge"' /var/www/ogaac-test/html/pages/operador/suipacha/sala*/index.html
```

### 3. data-permission en audiencia
```bash
grep -n 'card-audright.*data-permission' /var/www/ogaac-test/html/pages/operador/suipacha/sala*/index.html
```

### 4. data-permission en OBS
```bash
grep -n 'card-obsright.*data-permission' /var/www/ogaac-test/html/pages/operador/suipacha/sala*/index.html
```

### 5. Probar en navegador

**Como viewer:**
- URL: `http://10.54.15.60:8080/operador/suipacha/sala02/`
- Verificar que los controles están ocultos

**Como operator:**
- URL: `http://10.54.15.60:8080/operador/suipacha/sala02/`
- Verificar que los controles son visibles

**Como admin:**
- Verificar acceso completo incluyendo link "Avanzado"

---

## Referencia de Permisos

| Permission | Descripción | Roles con acceso |
|------------|-------------|------------------|
| `view:stream` | Ver video en vivo | viewer, operator, admin |
| `view:status` | Ver estado de sala | viewer, operator, admin |
| `view:advanced` | Ver link avanzado OBS | admin |
| `control:recording` | Controlar grabación | operator, admin |
| `control:obs` | Controlar OBS | operator, admin |
| `control:audio` | Controlar audio | operator, admin |

---

**Última actualización:** 2026-01-07
