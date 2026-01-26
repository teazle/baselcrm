#!/bin/bash

# Script to create a free tier EC2 instance in Singapore using AWS CLI
# This creates a t4g.small instance (free for 12 months)

set -e

echo "=== Creating Free Tier EC2 Instance in Singapore ==="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check AWS credentials
echo -e "${YELLOW}Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity --profile baselrpa &> /dev/null; then
    echo -e "${RED}AWS credentials not configured for baselrpa profile${NC}"
    exit 1
fi

ACCOUNT=$(aws sts get-caller-identity --profile baselrpa --query Account --output text)
echo -e "${GREEN}AWS Account: $ACCOUNT${NC}"

# Configuration
PROFILE="baselrpa"
REGION="ap-southeast-1"
INSTANCE_TYPE="t4g.small"  # Free tier eligible
AMI_ID=""  # Will find latest Ubuntu 22.04
KEY_NAME="baselrpa-singapore-key"
SECURITY_GROUP="baselrpa-sg"

echo ""
echo -e "${YELLOW}Configuration:${NC}"
echo "  Profile: $PROFILE"
echo "  Region: $REGION"
echo "  Instance Type: $INSTANCE_TYPE (Free tier)"
echo ""

# Find latest Ubuntu 22.04 LTS AMI
echo -e "${YELLOW}Finding latest Ubuntu 22.04 LTS AMI...${NC}"
AMI_ID=$(aws ec2 describe-images \
    --profile $PROFILE \
    --region $REGION \
    --owners 099720109477 \
    --filters \
        "Name=name,Values=ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-arm64-server-*" \
        "Name=state,Values=available" \
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' \
    --output text)

if [ -z "$AMI_ID" ] || [ "$AMI_ID" == "None" ]; then
    echo -e "${RED}Could not find Ubuntu 22.04 AMI${NC}"
    exit 1
fi

echo -e "${GREEN}Found AMI: $AMI_ID${NC}"

# Check if key pair exists
echo ""
echo -e "${YELLOW}Checking for SSH key pair...${NC}"
if ! aws ec2 describe-key-pairs --profile $PROFILE --region $REGION --key-names $KEY_NAME &> /dev/null; then
    echo -e "${YELLOW}Creating SSH key pair...${NC}"
    aws ec2 create-key-pair \
        --profile $PROFILE \
        --region $REGION \
        --key-name $KEY_NAME \
        --query 'KeyMaterial' \
        --output text > ~/.ssh/${KEY_NAME}.pem
    
    chmod 400 ~/.ssh/${KEY_NAME}.pem
    echo -e "${GREEN}Key pair created: ~/.ssh/${KEY_NAME}.pem${NC}"
else
    echo -e "${GREEN}Key pair already exists${NC}"
fi

# Check if security group exists
echo ""
echo -e "${YELLOW}Checking for security group...${NC}"
SG_ID=$(aws ec2 describe-security-groups \
    --profile $PROFILE \
    --region $REGION \
    --group-names $SECURITY_GROUP \
    --query 'SecurityGroups[0].GroupId' \
    --output text 2>/dev/null || echo "")

if [ -z "$SG_ID" ] || [ "$SG_ID" == "None" ]; then
    echo -e "${YELLOW}Creating security group...${NC}"
    
    # Get VPC ID
    VPC_ID=$(aws ec2 describe-vpcs \
        --profile $PROFILE \
        --region $REGION \
        --filters "Name=isDefault,Values=true" \
        --query 'Vpcs[0].VpcId' \
        --output text)
    
    SG_ID=$(aws ec2 create-security-group \
        --profile $PROFILE \
        --region $REGION \
        --group-name $SECURITY_GROUP \
        --description "Security group for Basel RPA automation" \
        --vpc-id $VPC_ID \
        --query 'GroupId' \
        --output text)
    
    # Allow SSH
    aws ec2 authorize-security-group-ingress \
        --profile $PROFILE \
        --region $REGION \
        --group-id $SG_ID \
        --protocol tcp \
        --port 22 \
        --cidr 0.0.0.0/0
    
    echo -e "${GREEN}Security group created: $SG_ID${NC}"
else
    echo -e "${GREEN}Security group already exists: $SG_ID${NC}"
fi

# Create EC2 instance
echo ""
echo -e "${YELLOW}Creating EC2 instance...${NC}"
echo "  Instance Type: $INSTANCE_TYPE"
echo "  AMI: $AMI_ID"
echo "  Region: $REGION"
echo ""

INSTANCE_ID=$(aws ec2 run-instances \
    --profile $PROFILE \
    --region $REGION \
    --image-id $AMI_ID \
    --instance-type $INSTANCE_TYPE \
    --key-name $KEY_NAME \
    --security-group-ids $SG_ID \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=baselrpa-automation-sg},{Key=Project,Value=BaselRPA}]" \
    --query 'Instances[0].InstanceId' \
    --output text)

if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" == "None" ]; then
    echo -e "${RED}Failed to create instance${NC}"
    exit 1
fi

echo -e "${GREEN}Instance created: $INSTANCE_ID${NC}"
echo ""
echo -e "${YELLOW}Waiting for instance to be running...${NC}"
aws ec2 wait instance-running \
    --profile $PROFILE \
    --region $REGION \
    --instance-ids $INSTANCE_ID

# Get public IP
echo ""
echo -e "${YELLOW}Getting instance details...${NC}"
PUBLIC_IP=$(aws ec2 describe-instances \
    --profile $PROFILE \
    --region $REGION \
    --instance-ids $INSTANCE_ID \
    --query 'Reservations[0].Instances[0].PublicIpAddress' \
    --output text)

echo ""
echo -e "${GREEN}=== Instance Created Successfully ===${NC}"
echo ""
echo "Instance ID: $INSTANCE_ID"
echo "Public IP: $PUBLIC_IP"
echo "Region: $REGION"
echo ""
echo "SSH Connection:"
echo "  ssh -i ~/.ssh/${KEY_NAME}.pem ubuntu@$PUBLIC_IP"
echo ""
echo "Next Steps:"
echo "  1. Wait 1-2 minutes for instance to fully boot"
echo "  2. SSH to the instance"
echo "  3. Run: bash scripts/deploy-to-cloud.sh"
echo "  4. Configure .env with your credentials"
echo "  5. Start developing MHC Asia form filling!"
echo ""
