import re
import os

file_path = r'd:\Skirk-macro\src\macro\main.py'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

sleep_exact_code = '''
def wait_exact(duration, start_time=None):
    """
    Tránh nghẽn luồng (GIL Starvation) làm khựng chuột do pynput bị chặn.
    Dùng perf_counter để đếm chính xác.
    Nếu thời gian chờ > 2ms, dùng time.sleep để nhường CPU cho OS và pynput.
    """
    if start_time is None:
        start_time = time.perf_counter()
    while True:
        remaining = duration - (time.perf_counter() - start_time)
        if remaining <= 0:
            break
        if remaining > 0.002:
            time.sleep(0.001)
'''

# Insert the wait_exact function right after the fps2t function
content = re.sub(r'(def fps2t\(.*?\):.*?return t_values\[0\]\n)', r'\1\n' + sleep_exact_code, content, flags=re.DOTALL)

# 1. Replace the spin loops
#     while time.perf_counter() - start < X:
#         pass
content = re.sub(
    r'([ \t]*)while time\.perf_counter\(\) - start < (.*?):\n[ \t]*pass\n',
    r'\1wait_exact(\2, start)\n',
    content
)

# 2. Replace time.sleep(X) with wait_exact(X) everywhere
content = re.sub(r'time\.sleep\((.*?)\)', r'wait_exact(\1)', content)

# 3. Restore time.sleep inside wait_exact itself!
content = content.replace('wait_exact(0.001)', 'time.sleep(0.001)')

# 4. Restore time.sleep in specific daemon threads or non-macro places
# Looking at the code, time.sleep(10), time.sleep(2), time.sleep(0.2) were used in daemon threads.
content = content.replace('wait_exact(10)', 'time.sleep(10)')
content = content.replace('wait_exact(2)', 'time.sleep(2)')
content = content.replace('wait_exact(0.2)', 'time.sleep(0.2)')

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Replacement completed.")
