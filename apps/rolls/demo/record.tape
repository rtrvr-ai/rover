# rtrvr rolls — terminal recording
# Install: brew install charmbracelet/tap/vhs
# Run:     vhs apps/rolls/demo/record.tape

Output apps/rolls/demo/rtrvr-rolls-demo.gif
Output apps/rolls/demo/rtrvr-rolls-demo.mp4

Set Shell "zsh"
Set FontFamily "JetBrains Mono"
Set FontSize 16
Set Width 900
Set Height 600
Set Padding 20
Set Theme { "background": "#1a1a19", "foreground": "#f5f5f0", "cursor": "#FF4C00", "black": "#1a1a19", "red": "#ff5f57", "green": "#28c840", "yellow": "#febc2e", "blue": "#5ca8ff", "magenta": "#ff6bff", "cyan": "#5af0e6", "white": "#f5f5f0" }
Set TypingSpeed 60ms
Set CursorBlink true

# Scene 1: type the command
Sleep 500ms
Type "npx -p @rtrvr-ai/rover rtrvr-rolls"
Sleep 400ms
Enter
Sleep 2500ms

# Scene 2: welcome screen — press Enter
Enter
Sleep 1500ms

# Scene 3: menu — browse down twice, then select
Sleep 500ms
Down
Sleep 600ms
Down
Sleep 600ms
Down
Sleep 800ms
Enter
Sleep 6000ms

# Scene 4: order flow plays out automatically, wait for reveal
Sleep 3000ms

# Final pause on reveal
Sleep 3000ms
