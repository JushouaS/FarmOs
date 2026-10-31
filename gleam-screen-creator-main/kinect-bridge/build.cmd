@echo off
rem Builds kinect-bridge\bin\KinectBridge.exe with the C# compiler that ships with Windows.
rem Needs the Kinect for Windows SDK 2.0 (for Microsoft.Kinect.dll).
setlocal
cd /d "%~dp0"

set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
set KDLL=%ProgramFiles%\Microsoft SDKs\Kinect\v2.0_1409\Assemblies\Microsoft.Kinect.dll

if not exist "%CSC%" (
  echo C# compiler not found at %CSC%
  exit /b 1
)
if not exist "%KDLL%" (
  echo Microsoft.Kinect.dll not found. Install the Kinect for Windows SDK 2.0 first.
  exit /b 1
)

if not exist bin mkdir bin
copy /y "%KDLL%" bin\ >nul
"%CSC%" /nologo /target:exe /out:bin\KinectBridge.exe /reference:"%KDLL%" /reference:System.dll /reference:System.Core.dll Program.cs
if errorlevel 1 exit /b 1
echo Built bin\KinectBridge.exe
