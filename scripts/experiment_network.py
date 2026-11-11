"""Discover local LAN addresses without sending a request to an external service."""
import ipaddress
import json
import re
import socket
import subprocess
import sys

NETWORKS = tuple(map(ipaddress.ip_network, ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')))


def lan_ip(value):
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return False
    return ip.version == 4 and any(ip in network for network in NETWORKS)


def parse_ifconfig(text):
    rows = []
    interface = ''
    for line in text.splitlines():
        if line and not line[0].isspace():
            interface = line.split(':', 1)[0]
        match = re.search(r'\binet (\d+(?:\.\d+){3})\b', line)
        if match and lan_ip(match[1]):
            rows.append((match[1], interface))
    return rows


def parse_windows(text):
    value = json.loads(text.lstrip('\ufeff') or '[]') or []
    if isinstance(value, dict):
        value = [value]
    return [(x['IPAddress'], x.get('InterfaceAlias', '네트워크')) for x in value if lan_ip(x['IPAddress'])]


def discover():
    rows = []
    try:
        if sys.platform == 'win32':
            command = ('[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); '
                       'Get-NetIPAddress -AddressFamily IPv4 | Where-Object {$_.AddressState -eq "Preferred"} | '
                       'Select-Object IPAddress,InterfaceAlias | ConvertTo-Json -Compress')
            rows = parse_windows(subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command], encoding='utf-8', timeout=10))
        elif sys.platform == 'darwin':
            rows = parse_ifconfig(subprocess.check_output(['/sbin/ifconfig'], encoding='utf-8', timeout=10))
        else:
            values = json.loads(subprocess.check_output(['ip', '-j', '-4', 'addr', 'show', 'up'], encoding='utf-8', timeout=10))
            rows = [(a['local'], x['ifname']) for x in values for a in x['addr_info'] if lan_ip(a['local'])]
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        pass
    # Gets the local default-route address; UDP connect does not send a packet.
    primary = None
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('8.8.8.8', 80))
            primary = sock.getsockname()[0]
            if lan_ip(primary) and not any(ip == primary for ip, _ in rows):
                rows.append((primary, '기본 네트워크'))
    except OSError:
        pass
    unique = {ip: label for ip, label in rows}
    return sorted(unique.items(), key=lambda row: (row[0] != primary, row[1], row[0]))


def choose_host(explicit=None):
    rows = discover()
    if explicit:
        if not lan_ip(explicit):
            raise ValueError('현재 노트북의 사설 IPv4 주소를 입력하세요.')
        return explicit  # The server bind also verifies that this is a local interface.
    if not rows:
        raise ValueError('Wi-Fi 주소를 찾지 못했습니다. 연결 후 다시 실행하거나 --host로 현재 노트북 주소를 지정하세요.')
    if len(rows) == 1:
        host, label = rows[0]
        print(f'현재 네트워크: {label} / {host}')
        return host
    print('휴대폰과 같은 Wi-Fi에 연결된 어댑터를 고르세요. VPN/가상 어댑터 주소를 고르지 마세요.')
    for i, (host, label) in enumerate(rows, 1):
        print(f'{i}. {label}: {host}')
    while True:
        answer = input('번호: ').strip()
        if answer.isdigit() and 1 <= int(answer) <= len(rows):
            return rows[int(answer) - 1][0]


def ensure_local(host):
    if not lan_ip(host):
        raise ValueError('현재 노트북의 사설 IPv4 주소를 입력하세요.')
    try:
        with socket.socket() as sock:
            sock.bind((host, 0))
    except OSError:
        raise ValueError('이 노트북의 주소가 아닙니다. 현재 Wi-Fi에 맞는 주소로 다시 실행하세요.') from None
