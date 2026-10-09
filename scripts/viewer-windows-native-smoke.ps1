param(
    [Parameter(Mandatory = $true)]
    [string]$ViewerExe,
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$ScreenshotsDirectory,
    [switch]$ExpectUntrusted,
    [switch]$Part03DevIntegration,
    [switch]$Part04DevIntegration,
    [string]$Part04Fingerprint = "410964651c82df094a4e2e653e9340816b0c5f0b1908343ab55b493a0c0692c4"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($Part03DevIntegration -and $Part04DevIntegration) {
    throw "Choose only one development integration mode"
}

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class SolArchNativeWindow {
    public delegate bool EnumWindowsProc(IntPtr handle, IntPtr parameter);

    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr handle, out Rect rect);

    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr parameter);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr handle);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);

    public static IntPtr LargestVisibleWindow(int requestedProcessId) {
        IntPtr largest = IntPtr.Zero;
        long largestArea = 0;
        EnumWindows(delegate (IntPtr handle, IntPtr parameter) {
            uint processId;
            GetWindowThreadProcessId(handle, out processId);
            if (processId != requestedProcessId || !IsWindowVisible(handle)) return true;
            Rect rect;
            if (!GetWindowRect(handle, out rect)) return true;
            long area = (long)(rect.Right - rect.Left) * (rect.Bottom - rect.Top);
            if (area > largestArea) {
                largestArea = area;
                largest = handle;
            }
            return true;
        }, IntPtr.Zero);
        return largest;
    }

}
"@

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Wait-MainWindow([System.Diagnostics.Process]$Process) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $Process.Refresh()
        if ($Process.HasExited) {
            throw "Viewer exited before creating its main window"
        }
        if ($Process.MainWindowHandle -ne [IntPtr]::Zero) {
            return
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Viewer main window was not available within 20 seconds"
}

function Focus-Viewer([System.Diagnostics.Process]$Process) {
    $Process.Refresh()
    $shell = New-Object -ComObject WScript.Shell
    if (-not $shell.AppActivate($Process.Id)) {
        throw "Viewer window could not be focused"
    }
    Start-Sleep -Milliseconds 250
}

function Save-ViewerScreenshot(
    [System.Diagnostics.Process]$Process,
    [string]$Destination
) {
    Focus-Viewer $Process
    $windowHandle = [SolArchNativeWindow]::LargestVisibleWindow($Process.Id)
    if ($windowHandle -eq [IntPtr]::Zero) {
        throw "Viewer visible window was not found"
    }
    $rect = New-Object SolArchNativeWindow+Rect
    if (-not [SolArchNativeWindow]::GetWindowRect($windowHandle, [ref]$rect)) {
        throw "Viewer window bounds could not be read"
    }
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ($width -lt 375 -or $height -lt 560) {
        throw "Viewer window is smaller than the configured minimum: ${width}x${height}"
    }
    $bitmap = New-Object System.Drawing.Bitmap($width, $height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bitmap.Size)
        $bitmap.Save($Destination, [System.Drawing.Imaging.ImageFormat]::Png)
    }
    finally {
        $graphics.Dispose()
        $bitmap.Dispose()
    }
}

function Wait-CdpTarget([int]$Port) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        try {
            $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list"
            $target = $targets | Where-Object { $_.type -eq "page" } | Select-Object -First 1
            if ($null -ne $target) {
                return $target
            }
        }
        catch {
            # WebView2 may not have bound the loopback test port yet.
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "WebView2 test target was not available within 20 seconds"
}

function Invoke-CdpCommand([object]$Target, [string]$Method, [hashtable]$Params) {
    $client = New-Object System.Net.WebSockets.ClientWebSocket
    try {
        $null = $client.ConnectAsync(
            [Uri]$Target.webSocketDebuggerUrl,
            [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()
        $request = @{
            id = 1
            method = $Method
            params = $Params
        } | ConvertTo-Json -Compress -Depth 6
        $bytes = [Text.Encoding]::UTF8.GetBytes($request)
        $segment = New-Object System.ArraySegment[byte] -ArgumentList @(,$bytes)
        $null = $client.SendAsync(
            $segment,
            [System.Net.WebSockets.WebSocketMessageType]::Text,
            $true,
            [Threading.CancellationToken]::None
        ).GetAwaiter().GetResult()

        $buffer = New-Object byte[] 65536
        $stream = New-Object System.IO.MemoryStream
        do {
            $receiveSegment = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
            $received = $client.ReceiveAsync(
                $receiveSegment,
                [Threading.CancellationToken]::None
            ).GetAwaiter().GetResult()
            $stream.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)
        $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
        $protocolError = $response.PSObject.Properties["error"]
        if ($null -ne $protocolError) {
            throw "WebView2 command failed: $($response | ConvertTo-Json -Compress -Depth 8)"
        }
        return $response
    }
    finally {
        $client.Dispose()
    }
}

function Invoke-CdpExpression([object]$Target, [string]$Expression) {
    $response = Invoke-CdpCommand $Target "Runtime.evaluate" @{
        expression = $Expression
        returnByValue = $true
        awaitPromise = $true
    }
    $exceptionDetails = $response.result.PSObject.Properties["exceptionDetails"]
    if ($null -ne $exceptionDetails) {
        throw "WebView2 expression failed: $($response | ConvertTo-Json -Compress -Depth 8)"
    }
    $value = $response.result.result.PSObject.Properties["value"]
    if ($null -eq $value) {
        return $null
    }
    return $value.Value
}

function RightClick-Selector([object]$Target, [string]$Selector) {
    $escaped = $Selector.Replace("\", "\\").Replace("'", "\'")
    $coordinates = Invoke-CdpExpression $Target "(() => { const item = document.querySelector('$escaped'); if (!item) throw new Error('Selector missing: $escaped'); const rect = item.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()"
    $null = Invoke-CdpCommand $Target "Input.dispatchMouseEvent" @{
        type = "mousePressed"
        x = [double]$coordinates.x
        y = [double]$coordinates.y
        button = "right"
        clickCount = 1
    }
    $null = Invoke-CdpCommand $Target "Input.dispatchMouseEvent" @{
        type = "mouseReleased"
        x = [double]$coordinates.x
        y = [double]$coordinates.y
        button = "right"
        clickCount = 1
    }
}

function Wait-CdpTrue([object]$Target, [string]$Expression) {
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        if ((Invoke-CdpExpression $Target $Expression) -eq $true) {
            return
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    $snapshot = Invoke-CdpExpression $Target "JSON.stringify({ text: document.body.innerText, html: document.documentElement.outerHTML.slice(0, 1200) })"
    throw "Expected Viewer state was not available within 20 seconds. DOM: $snapshot"
}

function Select-ArchiveInDialog([string]$Path) {
    $idCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "1148"
    )
    $deadline = [DateTime]::UtcNow.AddSeconds(20)
    do {
        $fileName = [System.Windows.Automation.AutomationElement]::RootElement.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants,
            $idCondition
        )
        if ($null -ne $fileName) {
            $value = $fileName.GetCurrentPattern(
                [System.Windows.Automation.ValuePattern]::Pattern
            )
            ([System.Windows.Automation.ValuePattern]$value).SetValue($Path)
            $fileName.SetFocus()
            [System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
            return
        }
        Start-Sleep -Milliseconds 100
    } while ([DateTime]::UtcNow -lt $deadline)
    throw "Native file-name field was not available within 20 seconds"
}

function Stop-Viewer([System.Diagnostics.Process]$Process) {
    if (-not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force
        $Process.WaitForExit()
    }
}

function Click-Selector([object]$Target, [string]$Selector) {
    $escaped = $Selector.Replace("\", "\\").Replace("'", "\'")
    $null = Invoke-CdpExpression $Target "(() => { const item = document.querySelector('$escaped'); if (!item) throw new Error('Selector missing: $escaped'); item.click(); return true; })()"
}

function Click-ProtectedFile([object]$Target, [string]$Name) {
    $escaped = $Name.Replace("\", "\\").Replace("'", "\'")
    $null = Invoke-CdpExpression $Target "(() => { const button = [...document.querySelectorAll('.file-open-button')].find((item) => item.textContent?.trim() === '$escaped'); if (!button) throw new Error('Protected file missing: $escaped'); button.click(); return true; })()"
}

function Assert-NoViewerBrowserSurface(
    [System.Diagnostics.Process]$Process,
    [string]$ForbiddenNames
) {
    $handle = [SolArchNativeWindow]::LargestVisibleWindow($Process.Id)
    if ($handle -eq [IntPtr]::Zero) {
        throw "Viewer visible window was not found while checking browser UI"
    }
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
    $elements = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($element in $elements) {
        try {
            $name = $element.Current.Name
            $controlType = $element.Current.ControlType
            $isBrowserSurface =
                $controlType -eq [System.Windows.Automation.ControlType]::Menu -or
                $controlType -eq [System.Windows.Automation.ControlType]::MenuItem -or
                $controlType -eq [System.Windows.Automation.ControlType]::Window
            if ($isBrowserSurface -and $name -match $ForbiddenNames) {
                throw "Unexpected WebView2 command surface remained available: $name"
            }
        }
        catch [System.Windows.Automation.ElementNotAvailableException] {
            # A transient element closed while the UI Automation tree was read.
        }
    }
}

function Assert-CredentialService([string]$Service) {
    $listing = (& cmdkey.exe /list 2>&1) -join "`n"
    if (-not $listing.Contains($Service)) {
        throw "Expected Windows Credential Manager service was not found: $Service"
    }
}

function Assert-NoPlaintextSecrets([string]$Root) {
    $needles = @(
        "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
        "3caa61bc13e56473e913a85c33cf4d603ac99a517eea95ed4573e772b64435f7"
    )
    foreach ($file in Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue) {
        if ($file.Length -gt 65536) { continue }
        try {
            $text = [Text.Encoding]::UTF8.GetString([IO.File]::ReadAllBytes($file.FullName))
            foreach ($needle in $needles) {
                if ($text.Contains($needle)) {
                    throw "Secret material was found in plaintext app data: $($file.FullName)"
                }
            }
        }
        catch [System.IO.IOException] {
            # WebView may briefly retain cache files; application records are closed atomically.
        }
    }
}

function Remove-FixtureCredentials([string]$Scope) {
    $targets = @(
        "device-a-x25519-private-key.app.solarch.viewer.device.v1.dev.$Scope",
        "validated-utc-high-water.app.solarch.viewer.clock.v1.dev.$Scope",
        "187c3d6e6d4695fb5a1d53d58b732dda37d1951152a3f06999f970c939621249.app.solarch.viewer.intent.v1.dev.$Scope",
        "5b795d817d9aec4f6d2b44bf1457a5014215433456a89930782fa56db774779d.app.solarch.viewer.refresh.v1.dev.$Scope"
    )
    foreach ($target in $targets) {
        $null = & cmdkey.exe "/delete:$target" 2>&1
    }
}

[System.IO.Directory]::CreateDirectory($ScreenshotsDirectory) | Out-Null
if ([System.IO.Path]::GetExtension($ArchivePath) -ieq ".b64") {
    $decodedArchive = Join-Path $ScreenshotsDirectory "slr-v1-vector.slr"
    $encoded = [System.IO.File]::ReadAllText($ArchivePath).Trim()
    [System.IO.File]::WriteAllBytes(
        $decodedArchive,
        [System.Convert]::FromBase64String($encoded)
    )
    $ArchivePath = $decodedArchive
}
$originalAppData = $env:APPDATA
$originalLocalAppData = $env:LOCALAPPDATA
$devIntegration = $Part03DevIntegration -or $Part04DevIntegration
if ($devIntegration) {
    $runPrefix = if ($Part04DevIntegration) { "part04" } else { "part03" }
    $runId = "$runPrefix-$PID-$([DateTime]::UtcNow.Ticks)"
    $credentialScope = $runId
    $appDataSandbox = Join-Path $ScreenshotsDirectory "$runId-appdata"
    [System.IO.Directory]::CreateDirectory($appDataSandbox) | Out-Null
    $env:APPDATA = Join-Path $appDataSandbox "roaming"
    $env:LOCALAPPDATA = Join-Path $appDataSandbox "local"
    [System.IO.Directory]::CreateDirectory($env:APPDATA) | Out-Null
    [System.IO.Directory]::CreateDirectory($env:LOCALAPPDATA) | Out-Null
    $env:SOLARCH_DEV_CREDENTIAL_SCOPE = $credentialScope
    $env:SOLARCH_DEV_APP_DATA_DIR = Join-Path $appDataSandbox "viewer"
    $env:SOLARCH_DEV_BACKEND_FIXTURE = if ($Part04DevIntegration) { "part04-payment" } else { "part03-payment" }
    if ($Part04DevIntegration) {
        if ($Part04Fingerprint.Length -ne 64 -or $Part04Fingerprint -notmatch '^[0-9a-fA-F]{64}$') {
            throw "Part04Fingerprint must be 64 hexadecimal characters"
        }
        $env:SOLARCH_DEV_ARCHIVE_FINGERPRINT = $Part04Fingerprint.ToLowerInvariant()
    }
    $env:SOLARCH_DEV_CLOCK_UNIX_SECONDS = "1788825600"
}
$portProbe = [System.Net.Sockets.TcpListener]::new(
    [System.Net.IPAddress]::Loopback,
    0
)
$portProbe.Start()
$cdpPort = ([System.Net.IPEndPoint]$portProbe.LocalEndpoint).Port
$portProbe.Stop()
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$cdpPort"
$first = $null
$second = $null
$third = $null
$fourth = $null
$fifth = $null
$sixth = $null
$expectedArchiveTitle = if ($Part04DevIntegration) { "Synthetic renderer archive" } else { "Test archive" }
try {
    $first = Start-Process -FilePath $ViewerExe -PassThru
    Wait-MainWindow $first
    $target = Wait-CdpTarget $cdpPort
    Wait-CdpTrue $target "document.querySelectorAll('button').length >= 3"
    $null = Invoke-CdpExpression $target "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'EN'); if (!button) throw new Error('EN button missing'); button.click(); return true; })()"
    Wait-CdpTrue $target "document.documentElement.lang === 'en'"
    Save-ViewerScreenshot $first (Join-Path $ScreenshotsDirectory "viewer-native-en.png")
    $null = Invoke-CdpExpression $target "(() => { const button = document.querySelector('.locale-switcher button'); if (!button) throw new Error('Locale button missing'); button.click(); return true; })()"
    Wait-CdpTrue $target "document.documentElement.lang === 'ru'"
    Save-ViewerScreenshot $first (Join-Path $ScreenshotsDirectory "viewer-native-ru.png")
    Stop-Viewer $first
    Start-Sleep -Milliseconds 500

    $second = Start-Process -FilePath $ViewerExe -PassThru
    Wait-MainWindow $second
    $target = Wait-CdpTarget $cdpPort
    Wait-CdpTrue $target "document.querySelectorAll('button').length >= 3"
    Wait-CdpTrue $target "document.documentElement.lang === 'ru'"
    Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-ru-restart.png")
    $null = Invoke-CdpExpression $target "(() => { const button = document.querySelector('.empty-workspace .primary-button'); if (!button) throw new Error('Open button missing'); button.click(); return true; })()"
    Select-ArchiveInDialog $ArchivePath
    if ($ExpectUntrusted) {
        Wait-CdpTrue $target "document.querySelector('.failure-surface') !== null && document.querySelector('.archive-workspace') === null"
        Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-untrusted.png")
        Write-Output "WINDOWS_NATIVE_PRODUCTION_FAIL_CLOSED_PASS"
    }
    else {
        Wait-CdpTrue $target "document.querySelector('.archive-title-block h1')?.textContent === '$expectedArchiveTitle' && document.querySelector('.status-warning') !== null"
        Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-locked.png")
        if (-not $devIntegration) {
            Write-Output "WINDOWS_NATIVE_UI_SMOKE_PASS"
        }
        else {
            Click-Selector $target ".locale-switcher button:last-child"
            Wait-CdpTrue $target "document.documentElement.lang === 'en'"
            Click-Selector $target ".unlock-button"
            Wait-CdpTrue $target "document.querySelector('[data-qr-value]')?.getAttribute('data-qr-value') === 'solana:https://api.solarch.example/v1/solana-pay/payment-intents/pi_test_01/transaction'"
            Wait-CdpTrue $target "!document.body.innerText.includes('AAECAwQF') && !document.body.innerText.includes('refresh_token')"
            Assert-CredentialService "app.solarch.viewer.intent.v1.dev.$credentialScope"
            Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-payment-ready.png")
            Wait-CdpTrue $target "document.body.innerText.includes('Waiting for payment')"
            Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-payment-pending.png")
            Wait-CdpTrue $target "document.body.innerText.includes('Awaiting finality') && document.body.innerText.includes('still locked')"
            Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-awaiting-finality.png")
            Wait-CdpTrue $target "document.body.innerText.includes('Protected archive unlocked') && document.querySelector('.file-table tbody tr') !== null"
            Assert-CredentialService "app.solarch.viewer.refresh.v1.dev.$credentialScope"
            Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-unlocked.png")
            if ($Part04DevIntegration) {
                Wait-CdpTrue $target "document.querySelectorAll('.file-table tbody tr').length === 6"
                Click-ProtectedFile $target "01-pages.pdf"
                Wait-CdpTrue $target "document.querySelector('.pdf-viewport canvas')?.width > 0 && /Wallet.+License.+Archive/.test(document.querySelector('.watermark-overlay')?.getAttribute('aria-label') ?? '')"
                Click-Selector $target "button[aria-label='Next page']"
                Wait-CdpTrue $target "document.body.innerText.includes('Page 2 of 2')"
                Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-part04-pdf.png")

                foreach ($imageName in @("02-image.png", "03-image.jpg", "04-image.webp")) {
                    Click-ProtectedFile $target $imageName
                    Wait-CdpTrue $target "document.querySelector('.image-viewport img')?.complete === true && document.querySelector('.watermark-overlay') !== null && document.querySelector('.pdf-viewport') === null"
                }
                $null = Invoke-CdpExpression $target "(() => { window.__solarchContextPrevented = false; const image = document.querySelector('.image-viewport img'); const surface = document.querySelector('[data-protected-viewer=true]'); if (!image || !surface) throw new Error('Protected image surface missing'); surface.addEventListener('contextmenu', (event) => setTimeout(() => { window.__solarchContextPrevented = event.defaultPrevented; }, 0), { once: true }); image.focus(); return document.activeElement === image; })()"
                RightClick-Selector $target ".image-viewport img"
                Wait-CdpTrue $target "window.__solarchContextPrevented === true"
                Assert-NoViewerBrowserSurface $second "Save image|Save as|Сохранить|Контекст"
                $null = Invoke-CdpExpression $target "(() => { window.__solarchBlockedKeys = []; const surface = document.querySelector('[data-protected-viewer=true]'); const image = document.querySelector('.image-viewport img'); if (!surface || !image) throw new Error('Protected image surface missing'); surface.addEventListener('keydown', (event) => setTimeout(() => { if (event.defaultPrevented) window.__solarchBlockedKeys.push(event.key.toLowerCase()); }, 0)); image.focus(); return document.activeElement === image; })()"
                Focus-Viewer $second
                [System.Windows.Forms.SendKeys]::SendWait("^p")
                [System.Windows.Forms.SendKeys]::SendWait("^s")
                Wait-CdpTrue $target "window.__solarchBlockedKeys.includes('p') && window.__solarchBlockedKeys.includes('s')"
                Assert-NoViewerBrowserSurface $second "Print|Печать|Save|Сохранить"
                Write-Output "WINDOWS_WEBVIEW2_NO_EXPORT_PASS"
                Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-part04-image.png")

                Click-ProtectedFile $target "05-document.docx"
                Wait-CdpTrue $target "document.querySelector('.document-page')?.innerText.includes('Protected heading') && document.querySelector('.docx-table') !== null && document.querySelector('.image-viewport') === null"
                Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-part04-docx.png")

                Click-ProtectedFile $target "06-workbook.xlsx"
                Wait-CdpTrue $target "document.querySelectorAll('.xlsx-tabs [role=tab]').length === 2 && document.querySelector('.xlsx-grid')?.innerText.includes('Revenue')"
                $null = Invoke-CdpExpression $target "(() => { const tab = [...document.querySelectorAll('.xlsx-tabs [role=tab]')].find((item) => item.textContent === 'Overview'); if (!tab) throw new Error('Overview sheet missing'); tab.focus(); return document.activeElement === tab; })()"
                Focus-Viewer $second
                [System.Windows.Forms.SendKeys]::SendWait("{RIGHT}")
                Wait-CdpTrue $target "[...document.querySelectorAll('.xlsx-tabs [role=tab]')].some((item) => item.textContent === 'Details' && item.getAttribute('aria-selected') === 'true')"
                Wait-CdpTrue $target "document.querySelector('.xlsx-grid')?.innerText.includes('Details') && document.querySelector('.document-page') === null"
                Write-Output "WINDOWS_PROTECTED_KEYBOARD_NAVIGATION_PASS"
                Wait-CdpTrue $target "![...document.querySelectorAll('button,a')].some((item) => /^(Save As|Extract All|Open External|Download raw|Print)$/i.test((item.getAttribute('aria-label') ?? item.textContent ?? '').trim()))"
                Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-part04-xlsx.png")
            }
            Stop-Viewer $second
            $second = $null
            Assert-NoPlaintextSecrets $appDataSandbox
            Start-Sleep -Milliseconds 500

            $env:SOLARCH_DEV_BACKEND_FIXTURE = "part03-unavailable"
            $env:SOLARCH_DEV_CLOCK_UNIX_SECONDS = "1788825600"
            $third = Start-Process -FilePath $ViewerExe -PassThru
            Wait-MainWindow $third
            $target = Wait-CdpTarget $cdpPort
            Wait-CdpTrue $target "document.querySelector('.empty-workspace .primary-button') !== null"
            Click-Selector $target ".empty-workspace .primary-button"
            Select-ArchiveInDialog $ArchivePath
            Wait-CdpTrue $target "document.body.innerText.includes('Protected archive unlocked') && document.querySelector('.file-table tbody tr') !== null"
            if ($Part04DevIntegration) {
                Click-ProtectedFile $target "04-image.webp"
                Wait-CdpTrue $target "document.querySelector('.image-viewport img')?.complete === true && document.querySelector('.watermark-overlay') !== null"
            }
            Save-ViewerScreenshot $third (Join-Path $ScreenshotsDirectory "viewer-native-cached-reopen.png")
            Stop-Viewer $third
            $third = $null
            Start-Sleep -Milliseconds 500

            if ($Part04DevIntegration) {
                $env:SOLARCH_DEV_EXPIRY_AFTER_MILLIS = "2500"
                $sixth = Start-Process -FilePath $ViewerExe -PassThru
                Wait-MainWindow $sixth
                $target = Wait-CdpTarget $cdpPort
                Wait-CdpTrue $target "document.querySelector('.empty-workspace .primary-button') !== null"
                Click-Selector $target ".empty-workspace .primary-button"
                Select-ArchiveInDialog $ArchivePath
                Wait-CdpTrue $target "document.body.innerText.includes('Protected archive unlocked')"
                Click-ProtectedFile $target "05-document.docx"
                Wait-CdpTrue $target "document.querySelector('.document-page') !== null && document.querySelector('.watermark-overlay') !== null"
                Wait-CdpTrue $target "document.body.innerText.includes('Refresh required') && document.querySelector('.document-page') === null && document.querySelector('.watermark-overlay') === null"
                Save-ViewerScreenshot $sixth (Join-Path $ScreenshotsDirectory "viewer-native-part04-deadline-relock.png")
                Stop-Viewer $sixth
                $sixth = $null
                Remove-Item Env:SOLARCH_DEV_EXPIRY_AFTER_MILLIS -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 500
            }

            $env:SOLARCH_DEV_CLOCK_UNIX_SECONDS = "1788998400"
            $fourth = Start-Process -FilePath $ViewerExe -PassThru
            Wait-MainWindow $fourth
            $target = Wait-CdpTarget $cdpPort
            Wait-CdpTrue $target "document.querySelector('.empty-workspace .primary-button') !== null"
            Click-Selector $target ".empty-workspace .primary-button"
            Select-ArchiveInDialog $ArchivePath
            Wait-CdpTrue $target "document.body.innerText.includes('Refresh required') && document.querySelector('.file-table') === null"
            Save-ViewerScreenshot $fourth (Join-Path $ScreenshotsDirectory "viewer-native-refresh-required.png")
            Stop-Viewer $fourth
            $fourth = $null
            Start-Sleep -Milliseconds 500

            if (-not $Part04DevIntegration) {
                $env:SOLARCH_DEV_BACKEND_FIXTURE = "part03-refresh"
                $env:SOLARCH_DEV_CLOCK_UNIX_SECONDS = "1789084800"
                $fifth = Start-Process -FilePath $ViewerExe -PassThru
                Wait-MainWindow $fifth
                $target = Wait-CdpTarget $cdpPort
                Wait-CdpTrue $target "document.querySelector('.empty-workspace .primary-button') !== null"
                Click-Selector $target ".empty-workspace .primary-button"
                Select-ArchiveInDialog $ArchivePath
                Wait-CdpTrue $target "document.body.innerText.includes('Protected archive unlocked') && document.querySelector('.file-table tbody tr') !== null"
                Save-ViewerScreenshot $fifth (Join-Path $ScreenshotsDirectory "viewer-native-refresh-success.png")
            }
            Assert-NoPlaintextSecrets $appDataSandbox
            if ($Part04DevIntegration) {
                Write-Output "WINDOWS_NATIVE_PART04_DEV_INTEGRATION_PASS"
            }
            else {
                Write-Output "WINDOWS_NATIVE_PART03_DEV_INTEGRATION_PASS"
            }
        }
    }
}
finally {
    if ($null -ne $first) {
        Stop-Viewer $first
    }
    if ($null -ne $second) {
        Stop-Viewer $second
    }
    if ($null -ne $third) {
        Stop-Viewer $third
    }
    if ($null -ne $fourth) {
        Stop-Viewer $fourth
    }
    if ($null -ne $fifth) {
        Stop-Viewer $fifth
    }
    if ($null -ne $sixth) {
        Stop-Viewer $sixth
    }
    if ($devIntegration -and $null -ne $credentialScope) {
        Remove-FixtureCredentials $credentialScope
    }
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
    Remove-Item Env:SOLARCH_DEV_BACKEND_FIXTURE -ErrorAction SilentlyContinue
    Remove-Item Env:SOLARCH_DEV_CLOCK_UNIX_SECONDS -ErrorAction SilentlyContinue
    Remove-Item Env:SOLARCH_DEV_CREDENTIAL_SCOPE -ErrorAction SilentlyContinue
    Remove-Item Env:SOLARCH_DEV_APP_DATA_DIR -ErrorAction SilentlyContinue
    Remove-Item Env:SOLARCH_DEV_ARCHIVE_FINGERPRINT -ErrorAction SilentlyContinue
    Remove-Item Env:SOLARCH_DEV_EXPIRY_AFTER_MILLIS -ErrorAction SilentlyContinue
    $env:APPDATA = $originalAppData
    $env:LOCALAPPDATA = $originalLocalAppData
}
