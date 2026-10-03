#ifndef AppVersion
  #error AppVersion must be supplied by build-installer.ps1
#endif
#ifndef AppSourceDir
  #error AppSourceDir must be supplied by build-installer.ps1
#endif

[Setup]
AppId=ru.frommer.karasyncstudio
AppName=Караоке Синк Студио
AppVersion={#AppVersion}
AppPublisher=Frommer
DefaultDirName={code:GetDefaultInstallDir}
DefaultGroupName=Караоке Синк Студио
UninstallDisplayName=Караоке Синк Студио
UninstallDisplayIcon={app}\Karaoke Sync Studio.exe
UsePreviousAppDir=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
LanguageDetectionMethod=none
ShowLanguageDialog=no
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
SetupIconFile=..\electron\icon.ico
OutputBaseFilename=Karaoke-Sync-Studio_v{#AppVersion}_Setup

[Languages]
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[Tasks]
Name: "desktopicon"; Description: "Создать ярлык на рабочем столе"; GroupDescription: "Дополнительные задачи:"

[Files]
Source: "{#AppSourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Караоке Синк Студио"; Filename: "{app}\Karaoke Sync Studio.exe"
Name: "{autodesktop}\Караоке Синк Студио"; Filename: "{app}\Karaoke Sync Studio.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Karaoke Sync Studio.exe"; Description: "Запустить приложение"; Flags: nowait postinstall skipifsilent

[Code]
function GetDefaultInstallDir(Param: String): String;
begin
  if DirExists('D:\') then
    Result := 'D:\Apps\Караоке Синк Студио'
  else
    Result := 'C:\Apps\Караоке Синк Студио';
end;
