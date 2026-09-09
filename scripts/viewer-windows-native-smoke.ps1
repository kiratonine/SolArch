param(
    [Parameter(Mandatory = $true)]
    [string]$ViewerExe,
    [Parameter(Mandatory = $true)]
    [string]$ArchivePath,
    [Parameter(Mandatory = $true)]
    [string]$ScreenshotsDirectory,
    [switch]$ExpectUntrusted
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class SolArchNativeWindow {
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr handle, out Rect rect);

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
    $rect = New-Object SolArchNativeWindow+Rect
    if (-not [SolArchNativeWindow]::GetWindowRect($Process.MainWindowHandle, [ref]$rect)) {
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
            $receiveSegment = New-Object System.ArraySegment[byte] -ArgumentList @(,$buffer)
            $received = $client.ReceiveAsync(
                $receiveSegment,
                [Threading.CancellationToken]::None
            ).GetAwaiter().GetResult()
            $stream.Write($buffer, 0, $received.Count)
        } while (-not $received.EndOfMessage)
        $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json
        $protocolError = $response.PSObject.Properties["error"]
        $exceptionDetails = $response.result.PSObject.Properties["exceptionDetails"]
        if ($null -ne $protocolError -or $null -ne $exceptionDetails) {
            throw "WebView2 expression failed: $($response | ConvertTo-Json -Compress -Depth 8)"
        }
        return $response.result.result.value
    }
    finally {
        $client.Dispose()
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
    throw "Expected Viewer state was not available within 20 seconds"
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

[System.IO.Directory]::CreateDirectory($ScreenshotsDirectory) | Out-Null
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
try {
    $first = Start-Process -FilePath $ViewerExe -PassThru
    Wait-MainWindow $first
    $target = Wait-CdpTarget $cdpPort
    Wait-CdpTrue $target "document.querySelectorAll('button').length >= 3"
    $null = Invoke-CdpExpression $target "(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'English'); if (!button) throw new Error('English button missing'); button.click(); return true; })()"
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
    $null = Invoke-CdpExpression $target "(() => { const button = document.querySelector('.empty-state .primary-button'); if (!button) throw new Error('Open button missing'); button.click(); return true; })()"
    Select-ArchiveInDialog $ArchivePath
    if ($ExpectUntrusted) {
        Wait-CdpTrue $target "document.querySelector('.error-card') !== null && document.querySelector('.archive-card') === null"
        Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-untrusted.png")
        Write-Output "WINDOWS_NATIVE_PRODUCTION_FAIL_CLOSED_PASS"
    }
    else {
        Wait-CdpTrue $target "document.querySelector('.archive-title-block h1')?.textContent === 'Test archive' && document.querySelector('.locked-badge') !== null"
        Save-ViewerScreenshot $second (Join-Path $ScreenshotsDirectory "viewer-native-locked.png")
        Write-Output "WINDOWS_NATIVE_UI_SMOKE_PASS"
    }
}
finally {
    if ($null -ne $first) {
        Stop-Viewer $first
    }
    if ($null -ne $second) {
        Stop-Viewer $second
    }
    Remove-Item Env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS -ErrorAction SilentlyContinue
}
