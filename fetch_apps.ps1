Add-Type -AssemblyName System.Drawing
$apps = Get-StartApps
$result = @()

foreach ($app in $apps) {
    $iconBase64 = $null
    $path = $app.AppID
    
    if (Test-Path $path -PathType Leaf) {
        try {
            $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($path)
            if ($icon) {
                $bitmap = $icon.ToBitmap()
                $ms = New-Object System.IO.MemoryStream
                $bitmap.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                $iconBase64 = [Convert]::ToBase64String($ms.ToArray())
                $ms.Close()
                $ms.Dispose()
                $bitmap.Dispose()
                $icon.Dispose()
            }
        } catch {
            # Ignore extraction errors
        }
    }
    
    $result += @{
        Name = $app.Name
        AppID = $app.AppID
        IconBase64 = $iconBase64
    }
}

$result | ConvertTo-Json -Depth 3
