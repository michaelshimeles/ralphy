@echo off
setlocal enabledelayedexpansion

echo Stopping any existing Ollama processes...
taskkill /F /IM ollama.exe 2>nul
taskkill /F /IM "ollama app.exe" 2>nul
taskkill /F /IM ollama_llama_server.exe 2>nul

echo Waiting 10 sec for processes to terminate...
timeout /t 10 /nobreak >nul

REM Kill any process using port 11434
set "PORT=11434"

echo Checking port %PORT%...
set "PIDS_KILLED="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%"') do (
    set "pid=%%a"
    if defined pid (
        if not "!pid!"=="0" (
            REM Check if we haven't already killed this PID
            echo !PIDS_KILLED! | findstr /C:"[%%a]" >nul
            if errorlevel 1 (
                echo Killing process on port %PORT% (PID: %%a)
                taskkill /F /PID %%a 2>nul
                set "PIDS_KILLED=!PIDS_KILLED![%%a]"
            )
        )
    )
)

if defined PIDS_KILLED (
    echo Waiting 5 sec after killing port processes...
    timeout /t 5 /nobreak >nul
)

REM Wait and re-check up to 6 times (~30s) for the port to be released
set attempts=0
:wait_loop
set /a attempts+=1
set "still="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%"') do set "still=1"
if defined still (
    if %attempts% LSS 6 (
        echo Port %PORT% still in use, attempt %attempts%/6 - waiting 5s...
        timeout /t 5 /nobreak >nul
        goto wait_loop
    ) else (
        echo Port %PORT% still in use after %attempts% attempts.
        echo Force killing remaining processes on the port:
        set "FINAL_PIDS="
        for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%PORT%"') do (
            set "pid=%%a"
            if defined pid (
                if not "!pid!"=="0" (
                    echo !FINAL_PIDS! | findstr /C:"[%%a]" >nul
                    if errorlevel 1 (
                        echo   Force killing PID: %%a
                        taskkill /F /PID %%a 2>nul
                        set "FINAL_PIDS=!FINAL_PIDS![%%a]"
                    )
                )
            )
        )
        echo Waiting 3 sec after final kill...
        timeout /t 3 /nobreak >nul
        goto start_ollama
    )
) else (
    echo Port %PORT% appears free.
)

:start_ollama
echo Starting Ollama with CORS support
set "OLLAMA_ORIGINS=*"
ollama serve

endlocal
