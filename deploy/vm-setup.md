# OpenClaw Gateway VM Setup

One-time provisioning steps for the GCE VM that runs the OpenClaw VRM operator.

## 1. Create VM

```bash
gcloud compute instances create openclaw-gateway \
  --project=jarvis-ml-dev \
  --zone=us-west2-a \
  --machine-type=e2-small \
  --image-family=debian-12 \
  --image-project=debian-cloud \
  --boot-disk-size=20GB \
  --tags=openclaw-gateway \
  --scopes=cloud-platform
```

## 2. Persistent Disk

```bash
# Create and attach data disk
gcloud compute disks create openclaw-data \
  --project=jarvis-ml-dev \
  --zone=us-west2-a \
  --size=10GB \
  --type=pd-standard

gcloud compute instances attach-disk openclaw-gateway \
  --project=jarvis-ml-dev \
  --zone=us-west2-a \
  --disk=openclaw-data

# SSH in and format/mount
sudo mkfs.ext4 /dev/sdb
sudo mkdir -p /mnt/openclaw-data
echo '/dev/sdb /mnt/openclaw-data ext4 defaults 0 2' | sudo tee -a /etc/fstab
sudo mount /mnt/openclaw-data
```

## 3. Install Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Allow current user to run docker without sudo
sudo usermod -aG docker $USER
```

## 4. Firewall

```bash
gcloud compute firewall-rules create allow-openclaw-gateway \
  --project=jarvis-ml-dev \
  --allow=tcp:18789 \
  --target-tags=openclaw-gateway \
  --source-ranges=0.0.0.0/0 \
  --description="OpenClaw gateway WebSocket + HTTP"
```

## 5. IAM — Secret Manager Access

```bash
# Get the VM's service account
SA=$(gcloud compute instances describe openclaw-gateway \
  --project=jarvis-ml-dev \
  --zone=us-west2-a \
  --format='value(serviceAccounts[0].email)')

gcloud projects add-iam-policy-binding jarvis-ml-dev \
  --member="serviceAccount:$SA" \
  --role="roles/secretmanager.secretAccessor"
```

## 6. Create Secrets (first time only)

```bash
PROJECT=jarvis-ml-dev

gcloud secrets create openclaw-gateway-token    --project=$PROJECT --replication-policy=automatic
gcloud secrets create openclaw-google-api-key    --project=$PROJECT --replication-policy=automatic
gcloud secrets create openclaw-slack-bot-token   --project=$PROJECT --replication-policy=automatic
gcloud secrets create openclaw-slack-app-token   --project=$PROJECT --replication-policy=automatic
gcloud secrets create openclaw-vrm-admin-api-key --project=$PROJECT --replication-policy=automatic
gcloud secrets create openclaw-jarvis-api-key    --project=$PROJECT --replication-policy=automatic

# Set initial values
echo -n "your-gateway-token" | gcloud secrets versions add openclaw-gateway-token --data-file=- --project=$PROJECT
# ... repeat for each secret
```

## 7. Directory Structure

```bash
sudo mkdir -p /opt/openclaw
sudo mkdir -p /mnt/openclaw-data/.openclaw/workspace/{ops,twiddy}
sudo mkdir -p /mnt/openclaw-data/logs

# Copy deployment files
sudo cp docker-compose.prod.yml /opt/openclaw/
sudo cp -r deploy/ /opt/openclaw/deploy/
sudo cp -r config/ /opt/openclaw/config/

# Make scripts executable
sudo chmod +x /opt/openclaw/deploy/*.sh
```

## 8. Install Systemd Service

```bash
sudo cp /opt/openclaw/deploy/openclaw.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable openclaw
```

## 9. Log Rotation Cron

```bash
# Delete structured logs older than 30 days
(crontab -l 2>/dev/null; echo '0 3 * * * find /mnt/openclaw-data/logs -name "openclaw-*.log" -mtime +30 -delete') | crontab -
```

## 10. Verify

```bash
# Start the service
sudo systemctl start openclaw

# Check status
sudo systemctl status openclaw
docker compose -f /opt/openclaw/docker-compose.prod.yml ps

# Health check
curl http://localhost:18789/health

# Test reboot recovery
sudo reboot
# After reboot: curl http://localhost:18789/health
```
