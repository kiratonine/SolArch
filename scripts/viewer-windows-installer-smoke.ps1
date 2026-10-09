param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$ArtifactsDirectory
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$russianLabel = ([char[]](0x420, 0x443, 0x441, 0x441, 0x43A, 0x438, 0x439)) -join ""

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class SolArchInstallerWindow {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
}
"@

function Wait-Until([scriptblock]$Condition, [string]$Failure, [int]$Seconds = 25) {
    $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw $Failure
}

function Get-ViewerInstallation {
    $root = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
    foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
        $item = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
        if ($null -eq $item) { continue }
        if ($item.DisplayName -eq "SolArch Viewer") { return $item }
    }
    return $null
}

function Stop-ViewerProcesses {
    Get-Process -Name "solarch-viewer" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

function Stop-InstallerProcesses {
    Get-Process -ErrorAction SilentlyContinue |
        Where-Object { $_.ProcessName -like "SolArch Viewer*setup*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

function Invoke-SilentUninstall {
    $installation = Get-ViewerInstallation
    if ($null -eq $installation) { return }
    Stop-ViewerProcesses
    $uninstaller = [string]$installation.UninstallString
    if ($uninstaller.StartsWith('"')) {
        $uninstaller = $uninstaller.Trim('"')
    }
    $process = Start-Process -FilePath $uninstaller -ArgumentList "/S" -PassThru
    if (-not $process.WaitForExit(60000)) {
        Stop-Process -Id $process.Id -Force
        throw "SolArch uninstaller timed out"
    }
    if ($process.ExitCode -ne 0) {
        throw "SolArch uninstaller failed with exit code $($process.ExitCode)"
    }
    Wait-Until { $null -eq (Get-ViewerInstallation) } "SolArch remained registered after uninstall"
}

function Get-AssociationDefault {
    try {
        return (Get-Item -LiteralPath "Registry::HKEY_CURRENT_USER\Software\Classes\.slr").GetValue("")
    }
    catch { return $null }
}

function Clear-InstallerLanguage {
    Remove-ItemProperty -LiteralPath "HKCU:\Software\SolArch\SolArch Viewer" -Name "Installer Language" -ErrorAction SilentlyContinue
}

function Assert-InstallerLanguageSelector {
    Stop-InstallerProcesses
    $installer = Start-Process -FilePath $InstallerPath -PassThru
    try {
        $processCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
            $installer.Id
        )
        $comboCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ComboBox
        )
        $script:combo = $null
        Wait-Until {
            $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                $processCondition
            )
            if ($null -eq $window) { return $false }
            $script:combo = $window.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                $comboCondition
            )
            return $null -ne $script:combo
        } "NSIS language selector was not shown before installation"

        $expand = $script:combo.GetCurrentPattern(
            [System.Windows.Automation.ExpandCollapsePattern]::Pattern
        )
        ([System.Windows.Automation.ExpandCollapsePattern]$expand).Expand()
        $listTypeCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::ListItem
        )
        $listCondition = New-Object System.Windows.Automation.AndCondition(
            $processCondition,
            $listTypeCondition
        )
        $script:labels = @()
        $script:allLabels = @()
        try {
            Wait-Until {
                $items = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    $listCondition
                )
                $script:allLabels = @($items | ForEach-Object { $_.Current.Name } | Sort-Object -Unique)
                $script:labels = @($script:allLabels |
                    Where-Object { $_ -eq $russianLabel -or $_ -eq "English" })
                return $script:labels.Count -eq 2
            } "NSIS selector did not expose exact RU / English labels"
        }
        catch {
            $diagnostic = @($script:allLabels | ForEach-Object {
                $codes = @($_.ToCharArray() | ForEach-Object { [int]$_ }) -join ','
                "$_ [$codes]"
            }) -join ' | '
            throw "NSIS selector did not expose exact RU / English labels. Installer list items: $diagnostic"
        }
        if (@($script:labels | Where-Object { $_ -notin @($russianLabel, "English") }).Count -ne 0) {
            throw "NSIS selector exposed an unsupported installer language"
        }
        Write-Output "WINDOWS_NSIS_LANGUAGE_SELECTOR_PASS"
    }
    finally {
        if (-not $installer.HasExited) {
            Stop-Process -Id $installer.Id -Force
            $installer.WaitForExit()
        }
        Stop-InstallerProcesses
    }
}

function Install-SolArch([int]$LanguageId) {
    $expectedLabel = if ($LanguageId -eq 1049) { $russianLabel } else { "English" }
    $process = Start-Process -FilePath $InstallerPath -PassThru
    $processCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ProcessIdProperty,
        $process.Id
    )
    $comboCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ComboBox
    )
    $script:installCombo = $null
    Wait-Until {
        $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $processCondition
        )
        if ($null -eq $window) { return $false }
        $script:installCombo = $window.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $comboCondition
        )
        return $null -ne $script:installCombo
    } "NSIS language selector was unavailable for installation"
    $expand = $script:installCombo.GetCurrentPattern(
        [System.Windows.Automation.ExpandCollapsePattern]::Pattern
    )
    ([System.Windows.Automation.ExpandCollapsePattern]$expand).Expand()
    $nameCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        $expectedLabel
    )
    $listTypeCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::ListItem
    )
    $processListCondition = New-Object System.Windows.Automation.AndCondition(
        $processCondition,
        $listTypeCondition
    )
    $itemCondition = New-Object System.Windows.Automation.AndCondition(
        $processListCondition,
        $nameCondition
    )
    $languageItem = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $itemCondition
    )
    if ($null -eq $languageItem) {
        Stop-Process -Id $process.Id -Force
        throw "Requested NSIS installer language was unavailable: $LanguageId"
    }
    $selection = $languageItem.GetCurrentPattern(
        [System.Windows.Automation.SelectionItemPattern]::Pattern
    )
    ([System.Windows.Automation.SelectionItemPattern]$selection).Select()
    ([System.Windows.Automation.ExpandCollapsePattern]$expand).Collapse()

    $buttonType = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Button
    )
    $okName = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::NameProperty,
        "OK"
    )
    $okCondition = New-Object System.Windows.Automation.AndCondition(
        $buttonType,
        $okName
    )
    $languageWindow = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $processCondition
    )
    $okButton = $languageWindow.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $okCondition
    )
    if ($null -eq $okButton) {
        Stop-Process -Id $process.Id -Force
        throw "NSIS language selector confirmation button was unavailable"
    }
    $invoke = $okButton.GetCurrentPattern(
        [System.Windows.Automation.InvokePattern]::Pattern
    )
    ([System.Windows.Automation.InvokePattern]$invoke).Invoke()

    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    $shell = New-Object -ComObject WScript.Shell
    $checkBoxCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::CheckBox
    )
    while (-not $process.HasExited -and [DateTime]::UtcNow -lt $deadline) {
        if ($shell.AppActivate($process.Id)) {
            $window = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
                [System.Windows.Automation.TreeScope]::Descendants,
                $processCondition
            )
            if ($null -ne $window) {
                $checkBoxes = $window.FindAll(
                    [System.Windows.Automation.TreeScope]::Descendants,
                    $checkBoxCondition
                )
                foreach ($checkBox in $checkBoxes) {
                    try {
                        $toggle = $checkBox.GetCurrentPattern(
                            [System.Windows.Automation.TogglePattern]::Pattern
                        )
                        if (([System.Windows.Automation.TogglePattern]$toggle).Current.ToggleState -eq
                            [System.Windows.Automation.ToggleState]::On) {
                            ([System.Windows.Automation.TogglePattern]$toggle).Toggle()
                        }
                    }
                    catch {
                        # The finish page may be closing while controls are inspected.
                    }
                }
            }
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
        }
        Start-Sleep -Milliseconds 800
        $process.Refresh()
    }
    if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
        throw "SolArch installer timed out"
    }
    if ($process.ExitCode -ne 0) {
        throw "SolArch installer failed with exit code $($process.ExitCode)"
    }
    Stop-ViewerProcesses
    Wait-Until { $null -ne (Get-ViewerInstallation) } "SolArch was not registered after install"
    Start-Sleep -Seconds 1
    $storedLanguage = (Get-ItemProperty -LiteralPath "HKCU:\Software\SolArch\SolArch Viewer")."Installer Language"
    if ([int]$storedLanguage -ne $LanguageId) {
        throw "NSIS did not persist selected language $LanguageId (stored: $storedLanguage)"
    }
    $installation = Get-ViewerInstallation
    $installLocation = ([string]$installation.InstallLocation).Trim('"')
    $viewer = Join-Path $installLocation "solarch-viewer.exe"
    if (-not (Test-Path -LiteralPath $viewer -PathType Leaf)) {
        throw "Installed Viewer executable was not found: $viewer"
    }
    return $viewer
}

function New-CdpPort {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
    $probe.Start()
    try { return ([System.Net.IPEndPoint]$probe.LocalEndpoint).Port }
    finally { $probe.Stop() }
}

function Wait-CdpTarget([int]$Port) {
    $script:target = $null
    Wait-Until {
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list"
            $script:target = $targets | Where-Object { $_.type -eq "page" } | Select-Object -First 1
            return $null -ne $script:target
        }
        catch { return $false }
    } "WebView2 test target was unavailable"
    return $script:target
}

function Invoke-CdpExpression([object]$Target, [string]$Expression) {
    $client = New-Object System.Net.WebSockets.ClientWebSocket
    try {
        $client.ConnectAsync(
            [Uri]$Target.webSocketDebuggerUrl,
            [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()
        $request = @{
            id = 1
            method = "Runtime.evaluate"
            params = @{
                expression = $Expression
                returnByValue = $true
                awaitPromise = $true
            }
        } | ConvertTo-Json -Compress -Depth 6
        $bytes = [Text.Encoding]::UTF8.GetBytes($request)
        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
        $client.SendAsync(
            $segment,
            [System.Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()
        $buffer = New-Object byte[] 65536
        $stream = New-Object System.IO.MemoryStream
        do {
            $receive = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
            $received = $client.ReceiveAsync(
                $receive,
                [Threading.CancellationToken]::None
            ).GetAwaiter().GetResult()
            $stream.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)
        $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
        if ($null -ne $response.PSObject.Properties["error"] -or
            $null -ne $response.result.PSObject.Properties["exceptionDetails"]) {
            throw "WebView2 expression failed: $($response | ConvertTo-Json -Compress -Depth 8)"
        }
        return $response.result.result.value
    }
    finally { $client.Dispose() }
}

function Wait-CdpTrue([object]$Target, [string]$Expression) {
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    do {
        try {
            if ((Invoke-CdpExpression $Target $Expression) -eq $true) { return }
        }
        catch {
            # The document may be navigating during startup.
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    $snapshot = Invoke-CdpExpression $Target "JSON.stringify({ lang: document.documentElement.lang, text: document.body.innerText.slice(0, 1000), locale: localStorage.getItem('solarch.viewer.locale') })"
    throw "Expected Viewer DOM state was unavailable for [$Expression]. DOM: $snapshot"
}

function Start-ViewerForLocale([string]$Viewer, [string]$ExpectedLocale, [string]$UserData) {
    $port = New-CdpPort
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
    $env:WEBVIEW2_USER_DATA_FOLDER = $UserData
    $process = Start-Process -FilePath $Viewer -PassThru
    $target = Wait-CdpTarget $port
    Wait-CdpTrue $target "document.documentElement.lang === '$ExpectedLocale' && document.querySelector('.empty-workspace') !== null"
    return @{ Process = $process; Target = $target; Port = $port }
}

function Stop-Viewer([System.Diagnostics.Process]$Process) {
    if (-not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
        $Process.WaitForExit()
    }
    Start-Sleep -Milliseconds 300
}

function Assert-Association([string]$Viewer) {
    $class = Get-AssociationDefault
    if ($class -ne "SolArch Archive") {
        throw ".slr is not registered as SolArch Archive (actual: $class)"
    }
    $description = (Get-Item -LiteralPath "Registry::HKEY_CURRENT_USER\Software\Classes\SolArch Archive").GetValue("")
    $command = (Get-Item -LiteralPath "Registry::HKEY_CURRENT_USER\Software\Classes\SolArch Archive\shell\open\command").GetValue("")
    if ($description -ne "SolArch Archive" -or
        -not $command.Contains($Viewer) -or
        -not $command.Contains('"%1"')) {
        throw "Installed .slr association is malformed: $command"
    }
}

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "Installer not found: $InstallerPath"
}
if (-not (Test-Path -LiteralPath $ArchivePath -PathType Leaf)) {
    throw "Archive not found: $ArchivePath"
}
[System.IO.Directory]::CreateDirectory($ArtifactsDirectory) | Out-Null
if ([System.IO.Path]::GetExtension($ArchivePath) -ieq ".b64") {
    $unicodeArchiveName = "installer-smoke-unicode-" +
        (([char[]](0x410, 0x440, 0x445, 0x438, 0x432)) -join "") + ".slr"
    $decoded = Join-Path $ArtifactsDirectory $unicodeArchiveName
    [System.IO.File]::WriteAllBytes(
        $decoded,
        [Convert]::FromBase64String([IO.File]::ReadAllText($ArchivePath).Trim())
    )
    $ArchivePath = $decoded
}

$deviceTarget = "device-a-x25519-private-key.app.solarch.viewer.device.v1"
$credentialsBefore = (& cmdkey.exe /list 2>&1) -join "`n"
$deviceExisted = $credentialsBefore.Contains($deviceTarget)
$installerLanguageBefore = $null
try {
    $installerLanguageBefore = (Get-Item -LiteralPath "HKCU:\Software\SolArch\SolArch Viewer").GetValue("Installer Language", $null)
}
catch {
    $installerLanguageBefore = $null
}
$baselineAssociation = Get-AssociationDefault
$viewerRun = $null
try {
    Stop-InstallerProcesses
    Invoke-SilentUninstall
    Clear-InstallerLanguage
    $baselineAssociation = Get-AssociationDefault
    Assert-InstallerLanguageSelector

    $russianData = Join-Path $ArtifactsDirectory "webview-russian"
    Remove-Item -LiteralPath $russianData -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $russianData) { throw "Russian WebView test profile could not be reset" }
    $env:WEBVIEW2_USER_DATA_FOLDER = $russianData
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    $viewer = Install-SolArch 1049
    Remove-Item -LiteralPath $russianData -Recurse -Force -ErrorAction SilentlyContinue
    Assert-Association $viewer
    $viewerRun = Start-ViewerForLocale $viewer "ru" $russianData
    $target = $viewerRun.Target
    $null = Invoke-CdpExpression $target "(() => { const button = [...document.querySelectorAll('.locale-switcher button')].find((item) => item.textContent?.trim() === 'EN'); if (!button) throw new Error('EN button missing'); button.click(); return true; })()"
    Wait-CdpTrue $target "document.documentElement.lang === 'en' && localStorage.getItem('solarch.viewer.locale') === 'en'"
    Stop-Viewer $viewerRun.Process
    $viewerRun = Start-ViewerForLocale $viewer "en" $russianData
    Stop-Viewer $viewerRun.Process
    $viewerRun = $null
    Write-Output "WINDOWS_INSTALLER_RU_AND_VIEWER_SWITCH_PERSIST_PASS"

    Invoke-SilentUninstall
    Clear-InstallerLanguage
    $englishData = Join-Path $ArtifactsDirectory "webview-english"
    Remove-Item -LiteralPath $englishData -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $englishData) { throw "English WebView test profile could not be reset" }
    $env:WEBVIEW2_USER_DATA_FOLDER = $englishData
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    $viewer = Install-SolArch 1033
    Remove-Item -LiteralPath $englishData -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $englishData) { throw "English WebView test profile was locked after installation" }
    Assert-Association $viewer
    $viewerRun = Start-ViewerForLocale $viewer "en" $englishData
    Stop-Viewer $viewerRun.Process
    $viewerRun = $null
    Write-Output "WINDOWS_INSTALLER_EN_FIRST_LAUNCH_PASS"

    $port = New-CdpPort
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
    $env:WEBVIEW2_USER_DATA_FOLDER = $englishData
    $before = @(Get-Process -Name "solarch-viewer" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
    $null = Start-Process -FilePath $ArchivePath
    Wait-Until { @(Get-Process -Name "solarch-viewer" -ErrorAction SilentlyContinue).Count -eq 1 } "Explorer-style .slr launch did not start one Viewer"
    $viewerProcess = Get-Process -Name "solarch-viewer" | Select-Object -First 1
    if ($before -contains $viewerProcess.Id) { throw "Cold .slr launch reused an unexpected prior process" }
    $target = Wait-CdpTarget $port
    Wait-CdpTrue $target "document.body.innerText.includes('not trusted') && document.querySelector('.failure-surface') !== null"

    $malformedSlr = Join-Path $ArtifactsDirectory "malformed-second.slr"
    [IO.File]::WriteAllBytes($malformedSlr, [byte[]](0x53, 0x4c, 0x52, 0x31))
    $null = Start-Process -FilePath $malformedSlr
    Wait-CdpTrue $target "document.body.innerText.includes('Archive verification failed')"
    if (@(Get-Process -Name "solarch-viewer" -ErrorAction SilentlyContinue).Count -ne 1) {
        throw "Second .slr open created another Viewer process"
    }
    $foreground = [SolArchInstallerWindow]::GetForegroundWindow()
    [uint32]$foregroundPid = 0
    $null = [SolArchInstallerWindow]::GetWindowThreadProcessId($foreground, [ref]$foregroundPid)
    if ($foregroundPid -ne $viewerProcess.Id) {
        throw "Existing Viewer was not brought to the foreground by the second .slr open"
    }
    Stop-Viewer $viewerProcess
    Write-Output "WINDOWS_FILE_ASSOCIATION_SINGLE_INSTANCE_PASS"

    $wrongPath = Join-Path $ArtifactsDirectory "not-an-archive.pdf"
    [IO.File]::WriteAllBytes($wrongPath, [byte[]](0x25, 0x50, 0x44, 0x46))
    $viewerRun = Start-ViewerForLocale $viewer "en" $englishData
    Stop-Viewer $viewerRun.Process
    $viewerRun = $null
    $port = New-CdpPort
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
    $invalidProcess = Start-Process -FilePath $viewer -ArgumentList ('"' + $wrongPath + '"') -PassThru
    $target = Wait-CdpTarget $port
    Wait-CdpTrue $target "document.querySelector('.empty-workspace') !== null && document.querySelector('.archive-workspace') === null"
    Stop-Viewer $invalidProcess
    $port = New-CdpPort
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$port"
    $extraProcess = Start-Process -FilePath $viewer -ArgumentList ('"' + $ArchivePath + '"'), "unexpected" -PassThru
    $target = Wait-CdpTarget $port
    Wait-CdpTrue $target "document.querySelector('.empty-workspace') !== null && document.querySelector('.archive-workspace') === null"
    Stop-Viewer $extraProcess
    Write-Output "WINDOWS_UNTRUSTED_ARGV_FAIL_CLOSED_PASS"

    Invoke-SilentUninstall
    $afterAssociation = Get-AssociationDefault
    if ($afterAssociation -eq "SolArch Archive" -or $afterAssociation -ne $baselineAssociation) {
        throw ".slr active association was not restored by uninstall (before: $baselineAssociation, after: $afterAssociation)"
    }
    Write-Output "WINDOWS_UNINSTALL_ASSOCIATION_CLEANUP_PASS"
}
finally {
    if ($null -ne $viewerRun) { Stop-Viewer $viewerRun.Process }
    Stop-ViewerProcesses
    Stop-InstallerProcesses
    Invoke-SilentUninstall
    if ($null -ne $installerLanguageBefore) {
        $key = New-Item -Path "HKCU:\Software\SolArch\SolArch Viewer" -Force
        $key.SetValue("Installer Language", [int]$installerLanguageBefore, [Microsoft.Win32.RegistryValueKind]::DWord)
    }
    else {
        Clear-InstallerLanguage
    }
    if (-not $deviceExisted) {
        $null = & cmdkey.exe "/delete:$deviceTarget" 2>&1
    }
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    Remove-Item Env:WEBVIEW2_USER_DATA_FOLDER -ErrorAction SilentlyContinue
}
