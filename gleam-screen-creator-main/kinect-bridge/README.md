# Kinect bridge

Streams a Kinect v2 depth camera to the web app over a WebSocket, so **Live Camera** can show it as
a live 3D point cloud. The full steps are in `HOW_TO_RUN.md` (section 7).

```
Kinect v2 --USB 3--> KinectBridge.exe --ws://localhost:8181--> Live Camera page
```

- Needs the Kinect for Windows SDK 2.0 and a USB 3.0 port.
- `build.cmd` compiles `Program.cs` with the C# compiler that ships with Windows. No Visual Studio or NuGet needed.
- The 3D viewer gets depth cut to 256x212 at about 15 frames per second. The weight finder requests paired 512x424 RGB-D frames at about 10 frames per second.
- Only pages from this PC or the local network may connect.
- `KinectBridge.exe --lan` listens for other devices. Windows requires an administrator window, or
  `netsh http add urlacl url=http://+:8181/ user=Everyone` once.
- The viewer is `src/components/farm/KinectDepthView.tsx`.
- The chicken finder can request synchronized RGB-D frames (`{"want":"rgbd"}`): each carries a paired color JPEG, full-resolution depth and Kinect depth-to-color map for the 17-feature weight model.
- If the Kinect drops out (a loose USB cable, power) and comes back without sending pictures again, the bridge
  notices after 5 seconds, prints `Nothing from the Kinect ... Opening it again.` and opens the sensor again. It
  waits longer between tries (up to a minute) while the Kinect stays gone.

## Picture or depth

A viewer gets depth frames unless it asks for the picture: it sends the text `{"want":"color"}` (and
`{"want":"depth"}` to go back). A picture frame is one binary message holding a JPEG of about 960x540, about
10 a second (it starts with the bytes `FF D8`, which a depth frame never does). Pictures are only made while a
viewer is asking for them. `build.cmd` needs `System.Drawing` for this, which Windows already has.

The finder asks for `{"want":"rgbd"}`. Those frames use Kinect's multi-source reader so the color image,
depth samples and depth-to-color coordinates belong to the same capture. Rebuild with `build.cmd` after
changing the bridge.
