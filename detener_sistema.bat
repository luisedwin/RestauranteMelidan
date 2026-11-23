@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Melidan Web - Detener Sistema

set "PORT=8000"
set "PG_SERVICE=postgresql-x64-18"

:: Leer puerto desde .env si existe
if exist ".env" (
    for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
        if /i "%%A"=="PORT" set "PORT=%%B"
    )
)
set "PORT=%PORT: =%"
if "%PORT%"=="" set "PORT=8000"

echo ========================================================
echo   Restaurante Melidan - Deteniendo todos los servicios
echo ========================================================
echo.

:: 1. Detener servidor Node.js en el puerto configurado
echo [1/3] Deteniendo servidor Node.js (puerto %PORT%)...
set "STOPPED_WEB=0"
for /f "tokens=5" %%P in ('netstat -aon 2^>nul ^| findstr /R /C:":%PORT% " ^| findstr /I "LISTENING"') do (
    if not "%%P"=="0" (
        taskkill /F /T /PID %%P >nul 2>&1
        if not errorlevel 1 set "STOPPED_WEB=1"
    )
)

:: Detener posibles procesos residuales de Node.js del proyecto (ej. node --watch src/server.js)
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'src[/\\]server\.js' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 set "STOPPED_WEB=1"

if "%STOPPED_WEB%"=="1" (
    echo       [OK] Servidor Node.js detenido.
) else (
    echo       [OK] No habia ningun servidor Node.js activo en el puerto %PORT%.
)

:: 2. Cerrar la ventana de consola de abrir_sistema.bat si sigue abierta
echo.
echo [2/3] Cerrando consola de abrir_sistema.bat...
set "STOPPED_CMD=0"
powershell -NoProfile -Command "$ids = @(); $ids += (Get-CimInstance Win32_Process -Filter 'Name=''cmd.exe''' -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match 'abrir_sistema\.bat' } | Select-Object -ExpandProperty ProcessId); $ids += (Get-Process cmd -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like 'Melidan Web - Servidor Activo*' } | Select-Object -ExpandProperty Id); $ids = $ids | Where-Object { $_ } | Select-Object -Unique; if ($ids) { $ids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }; exit 0 } else { exit 1 }" >nul 2>&1
if not errorlevel 1 set "STOPPED_CMD=1"
taskkill /FI "WINDOWTITLE eq Melidan Web - Servidor Activo*" /F /T >nul 2>&1

if "%STOPPED_CMD%"=="1" (
    echo       [OK] Consola de abrir_sistema.bat cerrada.
) else (
    echo       [OK] No habia ninguna consola de abrir_sistema.bat abierta.
)

:: 3. Detener servicio PostgreSQL 18 (sin modificar ni borrar datos)
echo.
echo [3/3] Deteniendo servicio PostgreSQL (%PG_SERVICE%)...
sc query "%PG_SERVICE%" >nul 2>&1
if errorlevel 1 (
    echo       [INFO] Servicio %PG_SERVICE% no encontrado en este equipo.
    goto :DONE
)

sc query "%PG_SERVICE%" 2>nul | findstr /I "RUNNING" >nul
if errorlevel 1 (
    echo       [OK] PostgreSQL ^(%PG_SERVICE%^) ya estaba detenido.
    goto :DONE
)

:: Comprobar si ya tenemos permisos de Administrador
net session >nul 2>&1
if not errorlevel 1 (
    net stop "%PG_SERVICE%" >nul 2>&1
) else (
    echo       Solicitando permisos de Administrador para detener PostgreSQL...
    powershell -NoProfile -Command "try { Start-Process -FilePath 'net' -ArgumentList 'stop','%PG_SERVICE%' -Verb RunAs -WindowStyle Hidden -Wait -ErrorAction Stop } catch { exit 1 }" >nul 2>&1
)

:: Confirmar estado final de PostgreSQL
sc query "%PG_SERVICE%" 2>nul | findstr /I "STOPPED" >nul
if not errorlevel 1 (
    echo       [OK] Servicio PostgreSQL ^(%PG_SERVICE%^) detenido.
) else (
    echo       [AVISO] No se detuvo PostgreSQL ^(permiso cancelado o servicio en uso^).
    echo               Para detenerlo, ejecuta este archivo como Administrador.
)

:DONE
echo.
echo ========================================================
echo   Listo: Proceso de detencion finalizado.
echo   Nota: Las pestanas de Chrome no se cierran automaticamente.
echo ========================================================
echo.
if /i not "%~1"=="--no-pause" pause
