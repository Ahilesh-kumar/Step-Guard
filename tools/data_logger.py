import serial
import csv
import time
import argparse
import sys
import os
import threading

def list_serial_ports():
    import serial.tools.list_ports
    ports = serial.tools.list_ports.comports()
    return [port.device for port in ports]

# --- METRONOME FEATURE ---
def run_metronome(stop_event):
    """
    Flashes the terminal screen and outputs an audible beep exactly every 1.5 seconds.
    This helps the patient synchronize their steps for consistent data gathering.
    """
    sys.stdout.write("\n--- METRONOME STARTING ---\n")
    sys.stdout.flush()
    while not stop_event.is_set():
        # Terminal visual flash and ascii bell (beep)
        sys.stdout.write("\r\033[47m\033[30m  [ STEP NOW! ]  \033[0m\a")
        sys.stdout.flush()
        time.sleep(0.2)
        sys.stdout.write("\r                 ")
        sys.stdout.flush()
        stop_event.wait(1.3) # 1.5s total loop time

def main():
    parser = argparse.ArgumentParser(description="StepGuard TENG Data Logger")
    parser.add_argument('--port', type=str, help='Serial port (e.g., COM3 on Windows)')
    parser.add_argument('--baud', type=int, default=115200, help='Baud rate')
    parser.add_argument('--label', type=str, choices=['normal', 'shuffling', 'tremor'], help='Activity label')
    
    args = parser.parse_args()

    port = args.port
    if not port:
        ports = list_serial_ports()
        if not ports:
            print("No serial ports found. Please check your connection.")
            sys.exit(1)
        print("Available ports:", ", ".join(ports))
        port = input("Enter port to use (e.g., COM3): ").strip()

    label = args.label
    if not label:
        print("\nAvailable Labels:")
        print("1 = normal (Use Metronome)")
        print("2 = shuffling (Use Metronome)")
        print("3 = tremor (No Metronome needed, stand still)")
        choice = input("Select label (1/2/3): ").strip()
        if choice == '1': label = 'normal'
        elif choice == '2': label = 'shuffling'
        elif choice == '3': label = 'tremor'
        else:
            print("Invalid choice.")
            sys.exit(1)

    filename = f"data_{label}_{int(time.time())}.csv"
    filepath = os.path.join(os.path.dirname(__file__), filename)

    print(f"\n==================================================")
    print(f"Connecting to: {port} at {args.baud} baud")
    print(f"Label: {label.upper()}")
    print(f"Destination: {filename}")
    print(f"==================================================\n")

    try:
        ser = serial.Serial(port, args.baud, timeout=1)
    except Exception as e:
        print(f"Error opening serial port: {e}")
        sys.exit(1)

    time.sleep(2) # stabilize
    ser.reset_input_buffer()

    print("Starting Logging in 3 seconds. Get ready...")
    time.sleep(3)

    # Start Metronome Thread
    stop_metronome = threading.Event()
    metronome_thread = None
    if label in ['normal', 'shuffling']:
        metronome_thread = threading.Thread(target=run_metronome, args=(stop_metronome,))
        metronome_thread.daemon = True
        metronome_thread.start()

    with open(filepath, mode='w', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(["timestamp", "teng_adc", "label"])
        
        try:
            start_time = time.time()
            data_points = 0
            while True:
                if ser.in_waiting > 0:
                    line = ser.readline().decode('utf-8').strip()
                    if line:
                        try:
                            val = int(line)
                            current_time = int((time.time() - start_time) * 1000)
                            writer.writerow([current_time, val, label])
                            data_points += 1
                            # We omit printing every data point so it doesn't mess up the metronome flash
                        except ValueError:
                            pass
        except KeyboardInterrupt:
            stop_metronome.set()
            print(f"\n\nLogging stopped. Saved {data_points} points to {filename}")
        finally:
            if metronome_thread:
                metronome_thread.join(timeout=1.0)
            ser.close()

if __name__ == "__main__":
    main()
